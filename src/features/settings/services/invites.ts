'use server';

// 招待の「発行・取り消し」の Server Action。
// 受け取り側（/invite/[token] での登録）は src/features/auth/services/invites.ts。
//
// ここでは service_role ではなく「セッション付きサーバクライアント」を使う。
// RLS（自組織の invites だけを select / insert / delete できる）がそのまま
// 二重の防壁になり、万一サーバ側チェックに漏れがあっても DB 側で拒否される。
// 招待の発行・取り消しは管理者だけに許す。RLS（current_user_is_admin()）でも止まるが、
// 拒否された操作は「0 行」で返り理由が分からないため、先に requireAdmin で分かりやすく断る。
// 招待の role は 'admin'（管理者）/ 'logger'（メンバー）だけを受け付ける。受諾時にそのまま profiles に写る。
// token・expiresAt・acceptedAt は列指定 GRANT の対象外なのでクライアントから指定できず、
// invitedByUserId はトリガで実行ユーザーに強制される。
// 発行・取り消しは system_audit_logs に残す（招待リンクの秘密である token は残さない。監査ログはメンバー全員が読めるため）。
//
// 招待メールの送信は createInvite の発行成功後に行う。送信の成否は招待の成立に
// 影響させず（未設定・失敗時はリンク共有にフォールバック）、結果を emailStatus で返す。

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/authz';
import type { ActionResult } from '@/types/actionResult';
import { logger } from '@/lib/logging/logger';
import { isValidEmail } from '@/lib/email';
import { MEMBER_ROLE, isAssignableMemberRole, type AssignableMemberRole } from '@/types/role';
import {
  isInviteEmailConfigured,
  sendInviteEmail,
  type InviteEmailStatus,
} from './inviteEmail';

// 発行済み招待。token は招待リンク（/invite/[token]）の秘密部分なので、
// 管理画面以外へ渡さないこと。
export interface IssuedInvite {
  token: string;
  email: string;
  expiresAt: string;
  /** 招待メールの送信結果。招待の成立とは独立で、UI の案内出し分けに使う */
  emailStatus: InviteEmailStatus;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 招待リンクの origin を求める。運用者が明示した APP_URL を最優先し（Host ヘッダは
// クライアントが偽装できるため、プロキシ構成によっては汚染され得る）、未設定の
// セルフホスト環境のみリクエストヘッダから導出するフォールバックにする。
const resolveRequestOrigin = async (): Promise<string | null> => {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    // 末尾スラッシュは招待リンク組み立て時の二重スラッシュを防ぐため取り除く
    return appUrl.replace(/\/+$/, '');
  }

  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  if (!host) return null;
  // x-forwarded-proto は多段プロキシで "https,http" のようにカンマ区切りになり得る。
  const forwardedProto = headerList.get('x-forwarded-proto')?.split(',')[0].trim();
  const protocol =
    forwardedProto ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
};

// 監査ログに残す。記録に失敗しても招待の操作は取り消さず、ログにだけ残す。
const recordInviteAudit = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  action: 'invite.create' | 'invite.revoke',
  detail: Record<string, string>,
) => {
  // userId はトリガ（set_system_audit_logs_user_id）が auth.uid() で上書きする。
  const { error } = await supabase.from('system_audit_logs').insert({
    organizationId,
    action,
    entityName: 'invites',
    detail: JSON.stringify(detail),
  });
  if (error) {
    logger.error({ error, action }, '招待の監査ログの記録に失敗しました');
  }
};

export const createInvite = async (input: {
  email: string;
  /** 招待を受けた人のロール（'admin' = 管理者 / 'logger' = メンバー）。省略時はメンバー */
  role?: AssignableMemberRole;
}): Promise<ActionResult<IssuedInvite>> => {
  // 受け取り側（acceptInvite）が小文字化して登録するため、発行時点で揃えておく。
  const email = String(input?.email ?? '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { ok: false, error: '有効なメールアドレスを入力してください' };
  }
  // Server Action はブラウザから任意の値で呼べるため、ロールの値もここで確かめる。
  const role = input?.role ?? MEMBER_ROLE;
  if (!isAssignableMemberRole(role)) {
    return { ok: false, error: 'ロールの値が正しくありません' };
  }

  const check = await requireAdmin();
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const caller = check.profile;

  const supabase = await createClient();

  // 既にメンバーになっているメールアドレスは招待できない。
  const { data: existingMember, error: memberError } = await supabase
    .from('profiles')
    .select('id')
    .eq('organizationId', caller.organizationId)
    .eq('email', email)
    .maybeSingle();
  if (memberError) {
    return { ok: false, error: '招待の作成に失敗しました' };
  }
  if (existingMember) {
    return { ok: false, error: 'このメールアドレスは既にメンバーです' };
  }

  // 同じメール宛の未受諾招待が残っていると部分一意インデックスに阻まれるため、
  // 先に消してから作り直す（期限切れ招待の再発行もこれで兼ねる）。
  const { error: deleteError } = await supabase
    .from('invites')
    .delete()
    .eq('organizationId', caller.organizationId)
    .eq('email', email)
    .is('acceptedAt', null);
  if (deleteError) {
    return { ok: false, error: '招待の作成に失敗しました' };
  }

  const { data: created, error: insertError } = await supabase
    .from('invites')
    .insert({ organizationId: caller.organizationId, email, role })
    .select('token, email, expiresAt')
    .single();
  if (insertError || !created) {
    return { ok: false, error: '招待の作成に失敗しました' };
  }

  await recordInviteAudit(supabase, caller.organizationId, 'invite.create', { email, role });

  // 招待メールの送信。送信対象はいま自組織に発行した招待のみ
  // （他組織の invite を指定する余地はない）。
  // 組織名・origin が取れない場合は送信を諦めて 'failed' とし、リンク共有に誘導する。
  const token = created.token as string;
  const expiresAt = created.expiresAt as string;

  let emailStatus: InviteEmailStatus = 'skipped';
  if (isInviteEmailConfigured()) {
    const [{ data: organization }, origin] = await Promise.all([
      supabase
        .from('organizations')
        .select('name')
        .eq('id', caller.organizationId)
        .maybeSingle(),
      resolveRequestOrigin(),
    ]);

    if (organization?.name && origin) {
      emailStatus = await sendInviteEmail({
        to: email,
        // fullName が未設定（null・空文字）の場合はメールアドレスを表示名にする
        inviterName: caller.fullName?.trim() || caller.email,
        organizationName: organization.name as string,
        inviteUrl: `${origin}/invite/${token}`,
        expiresAt,
      });
    } else {
      // 本文の材料（組織名・リンクの origin）が揃わない場合は送信自体を試みていない
      // ため「送信失敗」ではなく 'skipped' とし、UI 側でリンク共有に誘導する。
      logger.error('組織名または origin が取得できず招待メールを送信できません');
    }
  }

  return {
    ok: true,
    data: {
      token,
      email: created.email as string,
      expiresAt,
      emailStatus,
    },
  };
};

// 未受諾の招待を取り消す（発行済みリンクを無効化する）。
export const revokeInvite = async (token: string): Promise<ActionResult> => {
  if (!UUID_PATTERN.test(token)) {
    return { ok: false, error: 'この招待は取り消せません' };
  }

  const check = await requireAdmin();
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const caller = check.profile;

  // 自組織の招待だけを消せることは RLS（invites_delete_own_organization_admin）で担保する。
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from('invites')
    .delete()
    .eq('token', token)
    .is('acceptedAt', null)
    .select('token, email')
    .maybeSingle();
  if (error) {
    return { ok: false, error: '招待の取り消しに失敗しました' };
  }
  if (!deleted) {
    return { ok: false, error: 'この招待は既に使用済みか、取り消されています' };
  }

  await recordInviteAudit(supabase, caller.organizationId, 'invite.revoke', {
    email: deleted.email as string,
  });

  return { ok: true, data: undefined };
};
