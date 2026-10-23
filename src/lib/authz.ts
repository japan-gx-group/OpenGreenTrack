// 管理者だけに許す操作の入口で、ログイン中の人が管理者かを確かめる（サーバ専用）。
//
// ロールは必ずこの関数でサーバ側から読む（getCurrentProfile がリクエストのたびに profiles を読む）。
// ブラウザから送られたロールは改ざんできるため使わない。service_role を使う処理は RLS が効かないので、
// 管理者だけに許す操作では、service_role のクライアントを作る前にこれを通すこと。
//
// ⚠️ サーバ専用: cookies() を使う getCurrentProfile に依存するため Client Component から import しないこと。

import 'server-only';
import { getCurrentProfile, type CurrentProfile } from '@/lib/currentProfile';
import { isAdmin } from '@/types/role';

export const SIGNED_OUT_MESSAGE = 'セッションが確認できません。ログインし直してください';
export const ADMIN_ONLY_MESSAGE = '管理者のみ操作できます';

export type AdminCheck =
  | { ok: true; profile: CurrentProfile }
  | { ok: false; status: 401 | 403; error: string };

// Route Handler は status をそのまま返し、Server Action は error を ActionResult のエラーに使う。
export const requireAdmin = async (): Promise<AdminCheck> => {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { ok: false, status: 401, error: SIGNED_OUT_MESSAGE };
  }
  if (!isAdmin(profile.role)) {
    return { ok: false, status: 403, error: ADMIN_ONLY_MESSAGE };
  }
  return { ok: true, profile };
};
