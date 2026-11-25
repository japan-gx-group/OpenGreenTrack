// 管理者だけに許す操作・データを書き換える操作の入口で、ログイン中の人のロールを確かめる（サーバ専用）。
//
// ロールは必ずこの関数でサーバ側から読む（getCurrentProfile がリクエストのたびに profiles を読む）。
// ブラウザから送られたロールは改ざんできるため使わない。service_role を使う処理は RLS が効かないので、
// 管理者だけに許す操作では requireAdmin を、データを書き換える操作（算定・IDEA の取込・帳票・AI の読取りなど）では
// requireWrite を、service_role のクライアントを作る前に通すこと。
//
// ⚠️ サーバ専用: cookies() を使う getCurrentProfile に依存するため Client Component から import しないこと。

import 'server-only';
import { getCurrentProfile, type CurrentProfile } from '@/lib/currentProfile';
import { WRITE_FORBIDDEN_MESSAGE } from '@/lib/writePermission';
import { canWrite, isAdmin } from '@/types/role';

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

// データを書き換える操作の入口。閲覧者は 403 にする。
// プロフィールが無い（profiles 行が無い・ロールが不正）利用者は getCurrentProfile が null を返すため 401 になり、
// DB の current_user_can_edit() と同じく書けない。
export const requireWrite = async (): Promise<AdminCheck> => {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { ok: false, status: 401, error: SIGNED_OUT_MESSAGE };
  }
  if (!canWrite(profile.role)) {
    return { ok: false, status: 403, error: WRITE_FORBIDDEN_MESSAGE };
  }
  return { ok: true, profile };
};
