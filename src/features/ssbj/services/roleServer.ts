// SSBJ のロールの確認（サーバ側。docs/authorization-matrix.md §2.2）。
// service_role を使う Route Handler は RLS を越えるので、DB に持たせた SSBJ のロールが効かない。
// そのため、service_role の RPC を呼ぶ前に、操作者のロールがその操作を許すかをここで確かめる。
//
// ⚠️ サーバ専用: service_role の管理クライアント（createAdminClient）を使うため、Route Handler からのみ import すること。
// 操作者・組織は呼び出し元（Route Handler）が getCurrentProfile() で決めたものを渡す。

import { createAdminClient } from '@/lib/supabase/admin';
import type { SsbjEffectiveRole } from '../types';
import { isSsbjEffectiveRole, ssbjForbiddenMessage, ssbjRoleAllows, type SsbjPermission } from '../utils/memberRole';

/** 利用者の SSBJ のロール（組織の利用者でなければ null）。判定の正本は DB の ssbj_user_role。 */
export const getSsbjUserRole = async (userId: string, organizationId: string): Promise<SsbjEffectiveRole | null> => {
  const { data, error } = await createAdminClient().rpc('ssbj_user_role', {
    p_user_id: userId,
    p_organization_id: organizationId,
  });
  if (error) throw new Error(`SSBJ のロールの取得に失敗しました: ${error.message}`);
  if (data === null) return null;
  if (!isSsbjEffectiveRole(data)) throw new Error(`SSBJ のロールが不正です: ${String(data)}`);
  return data;
};

/** Route Handler が返す拒否（403 = ロールが許さない）。 */
export type SsbjRoleDenial = { status: 403; error: string };

/**
 * 操作者のロールがその操作を許さなければ拒否を、許せば null を返す。ロールを取得できないときは例外にする
 * （呼び出し元は 500 にする。確かめられないまま service_role の処理を進めない）。
 */
export const denySsbjRole = async (
  actor: { id: string; organizationId: string },
  permission: SsbjPermission,
): Promise<SsbjRoleDenial | null> => {
  const role = await getSsbjUserRole(actor.id, actor.organizationId);
  return ssbjRoleAllows(role, permission) ? null : { status: 403, error: ssbjForbiddenMessage(role, permission) };
};

/** Route Handler が返す拒否（403 = ロールが許さない、500 = ロールを確かめられない）。 */
export type SsbjRouteDenial = { status: 403 | 500; error: string };

/**
 * Route Handler 用: denySsbjRole の結果を返し、ロールを確かめられないときは onError に渡して 500 にする。
 * 使い方: `const denial = await guardSsbjRole(profile, 'edit', error => log.error(...)); if (denial) return ...;`
 */
export const guardSsbjRole = async (
  actor: { id: string; organizationId: string },
  permission: SsbjPermission,
  onError: (error: unknown) => void,
): Promise<SsbjRouteDenial | null> => {
  try {
    return await denySsbjRole(actor, permission);
  } catch (error) {
    onError(error);
    return { status: 500, error: 'サーバー内部エラーが発生しました' };
  }
};
