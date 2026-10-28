// SSBJ のロール（docs/authorization-matrix.md §1・§2.4）の取得と割り当て。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。自組織の割り当てだけが見える（RLS）。
// 割り当て・変更は OGT の管理者だけができる（RLS が止める）。変更は DB のトリガーが操作履歴に記録する。

import { createClient } from '@/lib/supabase/client';
import type { SsbjEffectiveRole, SsbjMemberRole, SsbjMemberRoleLog } from '../types';
import { isSsbjEffectiveRole, isSsbjMemberRole } from '../utils/memberRole';
import { SSBJ_FORBIDDEN_MESSAGE } from '../utils/writeError';

/** RLS が拒否したとき（管理者でない）の SQLSTATE。 */
const RLS_DENIED_SQLSTATE = '42501';

/** 自組織の割り当て（利用者 ID → ロール）。行が無い利用者は入力担当。 */
export const listSsbjMemberRoles = async (): Promise<Map<string, SsbjMemberRole>> => {
  const { data, error } = await createClient().from('ssbj_member_roles').select('userId, role');
  if (error) throw new Error('SSBJ のロールの取得に失敗しました');
  const roles = new Map<string, SsbjMemberRole>();
  for (const row of (data ?? []) as { userId: string; role: unknown }[]) {
    if (!isSsbjMemberRole(row.role)) throw new Error(`SSBJ のロールが不正です: ${String(row.role)}`);
    roles.set(row.userId, row.role);
  }
  return roles;
};

/** ログイン中の利用者の SSBJ のロール（組織の利用者でなければ null）。 */
export const getMySsbjRole = async (): Promise<SsbjEffectiveRole | null> => {
  const { data, error } = await createClient().rpc('ssbj_current_user_role');
  if (error) throw new Error('SSBJ のロールの取得に失敗しました');
  if (data === null) return null;
  if (!isSsbjEffectiveRole(data)) throw new Error(`SSBJ のロールが不正です: ${String(data)}`);
  return data;
};

/**
 * 作業中データの更新・削除が 0 件だったときに呼び、SSBJ のロールで止められたのかを確かめる。
 * RLS の RESTRICTIVE のポリシー（USING）で止められた更新・削除はエラー（42501）にならず 0 件になるので、画面を開いている間に
 * ロールが変わった利用者には、成功・競合・「見つかりません」に見えてしまう。今も編集できるかを DB に聞き、できなければ
 * 権限のメッセージで例外にする。確かめられないときは何もしない（呼び出し元の案内のままにする）。
 */
export const throwIfSsbjEditForbidden = async (): Promise<void> => {
  const { data, error } = await createClient().rpc('ssbj_current_user_can_edit');
  if (!error && data === false) throw new Error(SSBJ_FORBIDDEN_MESSAGE);
};

const assignErrorMessage = (error: { code?: string } | null): string =>
  error?.code === RLS_DENIED_SQLSTATE
    ? 'SSBJ のロールは管理者のみ変更できます'
    : 'SSBJ のロールの保存に失敗しました';

/** 利用者に SSBJ のロールを割り当てる（更新して、無ければ作る）。 */
export const assignSsbjMemberRole = async (userId: string, role: SsbjMemberRole): Promise<void> => {
  const supabase = createClient();
  const updated = await supabase.from('ssbj_member_roles').update({ role }).eq('userId', userId).select('userId');
  if (updated.error) throw new Error(assignErrorMessage(updated.error));
  if ((updated.data ?? []).length > 0) return;

  // 行が無ければ作る。管理者でなければ、更新は 0 行になり、作成は RLS が拒否する。
  const organization = await supabase.rpc('current_user_organization_id');
  if (organization.error || typeof organization.data !== 'string') {
    throw new Error('SSBJ のロールの保存に失敗しました');
  }
  const inserted = await supabase.from('ssbj_member_roles').insert({ organizationId: organization.data, userId, role });
  if (inserted.error) {
    // 23505: 別の画面で同時に、同じ利用者の最初の割り当てが作られた。
    if (inserted.error.code === '23505') throw new Error('他の画面で先に変更されました。画面を開き直してください');
    throw new Error(assignErrorMessage(inserted.error));
  }
};

/** 画面に出すロールの変更の記録の件数（新しい順）。 */
export const SSBJ_MEMBER_ROLE_LOG_LIMIT = 50;

type MemberRoleLogRow = {
  id: number;
  actorUserId: string | null;
  action: string;
  targetId: string | null;
  details: unknown;
  createdAt: string;
};

const roleOrNull = (value: unknown): SsbjMemberRole | null => (isSsbjMemberRole(value) ? value : null);

/** DB 行 → ロールの変更の記録。操作・対象が不正な行は例外にする（DB のトリガーと食い違っている）。 */
export const toSsbjMemberRoleLog = (row: MemberRoleLogRow): SsbjMemberRoleLog => {
  if ((row.action !== 'create' && row.action !== 'update' && row.action !== 'delete') || !row.targetId) {
    throw new Error(`SSBJ のロールの変更の記録が不正です: ${row.id}`);
  }
  const details = typeof row.details === 'object' && row.details !== null ? (row.details as Record<string, unknown>) : {};
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    userId: row.targetId,
    role: roleOrNull(details.role),
    previousRole: roleOrNull(details.previousRole),
    memberDeleted: details.reason === 'member_deleted',
    createdAt: row.createdAt,
  };
};

/** 自組織のロールの変更の記録（新しい順。最大 SSBJ_MEMBER_ROLE_LOG_LIMIT 件）。 */
export const listSsbjMemberRoleLogs = async (): Promise<SsbjMemberRoleLog[]> => {
  const { data, error } = await createClient()
    .from('ssbj_audit_logs')
    .select('id, actorUserId, action, targetId, details, createdAt')
    .eq('targetType', 'member_role')
    .order('id', { ascending: false })
    .limit(SSBJ_MEMBER_ROLE_LOG_LIMIT);
  if (error) throw new Error('SSBJ のロールの変更の記録の取得に失敗しました');
  return ((data ?? []) as MemberRoleLogRow[]).map(toSsbjMemberRoleLog);
};
