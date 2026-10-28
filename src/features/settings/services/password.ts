'use server';

// ログイン中ユーザーのパスワード変更の Server Action（設定＞アカウント）。
//
// なぜサーバ側で行うか:
//   supabase/config.toml の auth.secure_password_change を有効にすると、GoTrue は
//   ブラウザからの auth.updateUser({ password })（再認証 nonce 無し）を拒否する。
//   そのため「現在のパスワードの検証」と「新パスワードの反映」をどちらもサーバで行い、
//   反映は service_role の admin API（updateUserById）で行う。
//   本人確認をクライアントに任せない（signInWithPassword の結果を信用しない）ため、
//   一時的にセッションを奪われた状態で勝手にパスワードを変えられることも防げる。
//
// service_role は RLS も認証も越えるため、更新対象は必ず Cookie セッションのユーザー自身に固定する。

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
// 現在のパスワードの検証（使い捨てのクライアントで signInWithPassword）は、AI の鍵の登録と共通の処理にした。
import { verifyCurrentPassword } from '@/lib/reauth';
import type { ActionResult } from '@/types/actionResult';

const MIN_PASSWORD_LENGTH = 8;

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export const changePassword = async (input: ChangePasswordInput): Promise<ActionResult> => {
  const currentPassword = String(input.currentPassword ?? '');
  const newPassword = String(input.newPassword ?? '');

  if (!currentPassword) {
    return { ok: false, error: '現在のパスワードを入力してください' };
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上である必要があります。` };
  }

  // 1) 更新対象は Cookie セッションのユーザー本人に固定する（入力の id 等は一切受け取らない）。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { ok: false, error: 'ログイン情報が確認できませんでした。再度ログインしてください' };
  }

  // 2) 現在のパスワードで本人確認する。
  if (!(await verifyCurrentPassword(user.email, currentPassword))) {
    return { ok: false, error: '現在のパスワードが正しくありません' };
  }

  // 3) 新パスワードを反映する（secure_password_change の制約を受けない admin API 経由）。
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) {
    return { ok: false, error: 'パスワードの更新に失敗しました' };
  }

  return { ok: true, data: undefined };
};
