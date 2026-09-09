'use server';

// 招待リンク（/invite/[token]）の「受け取り側」の Server Action。
//
// 招待の「発行」とメール送信は src/features/settings/services/invites.ts 側。
// ここではトークンの検証と、招待された人の登録（既存組織への参加）だけを行う。
// profiles.role には招待の role をそのまま写すが、権限判定には使わない（ロール判定は無効）。
//
// service_role を使う理由は setup.ts と同じ（authenticated は profiles に INSERT できない）。

import { createAdminClient } from '@/lib/supabase/admin';
import type { MemberRole } from '@/types/role';
import type { AcceptInviteInput, ActionResult, InviteInfo } from '../types';

// invites テーブルから取り扱う列。
interface InviteRow {
  token: string;
  organizationId: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  acceptedAt: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// token 列は uuid 型。uuid でない文字列で問い合わせると Postgres が構文エラーを返すため、
// 事前に形式を確認して「無効なリンク」として扱う。
const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

type AdminClient = ReturnType<typeof createAdminClient>;

// トークンから招待を1件引いて有効性（未受諾・期限内）を検証する。無効なら理由を返す。
const loadValidInvite = async (
  admin: AdminClient,
  token: string,
): Promise<ActionResult<InviteRow>> => {
  const { data, error } = await admin
    .from('invites')
    .select('token, organizationId, email, role, expiresAt, acceptedAt')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    return { ok: false, error: '招待の確認に失敗しました' };
  }
  if (!data) {
    return { ok: false, error: 'この招待リンクは無効です' };
  }

  const invite = data as InviteRow;
  if (invite.acceptedAt) {
    return { ok: false, error: 'この招待は既に使用されています' };
  }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'この招待リンクは有効期限が切れています' };
  }
  return { ok: true, data: invite };
};

// 招待画面の表示用情報（組織名・メール・権限）を取得する。
export const getInviteForToken = async (
  token: string,
): Promise<ActionResult<InviteInfo>> => {
  if (!isUuid(token)) {
    return { ok: false, error: 'この招待リンクは無効です' };
  }

  const admin = createAdminClient();
  const invite = await loadValidInvite(admin, token);
  if (!invite.ok) {
    return invite;
  }

  const { data: org, error } = await admin
    .from('organizations')
    .select('name')
    .eq('id', invite.data.organizationId)
    .single();
  if (error || !org) {
    return { ok: false, error: '招待元の組織が見つかりません' };
  }

  return {
    ok: true,
    data: {
      email: invite.data.email,
      organizationName: org.name as string,
    },
  };
};

// 招待を受け取って登録を完了する（既存組織へ招待どおりの権限で参加）。
export const acceptInvite = async (
  input: AcceptInviteInput,
): Promise<ActionResult<{ email: string }>> => {
  if (!isUuid(input.token)) {
    return { ok: false, error: 'この招待リンクは無効です' };
  }
  const fullName = input.fullName.trim();
  if (!fullName) {
    return { ok: false, error: '氏名は必須です' };
  }
  if (input.password.length < 8) {
    return { ok: false, error: 'パスワードは8文字以上で設定してください' };
  }

  const admin = createAdminClient();

  // 受諾直前に再検証する（表示時点から期限切れ・受諾済みに変わっている可能性があるため）。
  const invite = await loadValidInvite(admin, input.token);
  if (!invite.ok) {
    return invite;
  }
  const email = invite.data.email.trim().toLowerCase();

  // 1) 招待を先に「確保」する。UPDATE ... WHERE acceptedAt IS NULL は原子的なので、
  //    同時に複数の受諾が来ても実際に行を取れるのは1つだけ。行が返らなければ既に受諾済み。
  //    （ユーザー作成の後で受諾フラグを立てる順序だと、フラグ更新が失敗したときに
  //     「メールは登録済みなのに招待は未使用のまま」という矛盾状態が残るため、先に確保する）
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('invites')
    .update({ acceptedAt: claimedAt })
    .eq('token', input.token)
    .is('acceptedAt', null)
    .select('token')
    .maybeSingle();
  if (claimError) {
    return { ok: false, error: '招待の受け取りに失敗しました' };
  }
  if (!claimed) {
    return { ok: false, error: 'この招待は既に使用されています' };
  }

  // 以降で失敗したら確保を戻す。自分が入れた claimedAt のときだけ null に戻すので、
  // 万一の入れ違いで他者が受諾していてもその受諾は壊さない。
  const releaseClaim = async () => {
    try {
      await admin
        .from('invites')
        .update({ acceptedAt: null })
        .eq('token', input.token)
        .eq('acceptedAt', claimedAt);
    } catch {
      // 戻し失敗は握りつぶす（招待は「使用済み」寄りに倒れる）
    }
  };

  // 2) 認証ユーザー作成（メール確認済み）。招待のメールアドレスを使う（ユーザーは変更できない）。
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) {
    await releaseClaim();
    if (createError?.status === 422) {
      return { ok: false, error: 'このメールアドレスは既に登録されています' };
    }
    return { ok: false, error: 'ユーザーの作成に失敗しました' };
  }
  const userId = created.user.id;

  const deleteUserQuiet = async () => {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      // 掃除失敗は握りつぶす
    }
  };

  // 3) プロフィール作成（招待の組織へ参加）。role は DB 値の互換のため招待値を引き継ぐ。
  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    organizationId: invite.data.organizationId,
    email,
    fullName,
    role: invite.data.role,
  });
  if (profileError) {
    await deleteUserQuiet();
    await releaseClaim();
    return { ok: false, error: 'プロフィールの作成に失敗しました' };
  }

  return { ok: true, data: { email } };
};
