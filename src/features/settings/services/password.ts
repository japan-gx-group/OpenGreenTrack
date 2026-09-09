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

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/types/actionResult';

const MIN_PASSWORD_LENGTH = 8;

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

// 現在のパスワードが正しいかを signInWithPassword で検証する。
// Cookie セッション用のクライアント（@/lib/supabase/server）で呼ぶと、検証で発行された
// 新しいセッションが Cookie に書き戻されて操作者のセッションが差し替わってしまうため、
// セッションを永続化しない使い捨てクライアント（anon key）で行う。
const verifyCurrentPassword = async (email: string, password: string): Promise<boolean> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;

  const throwaway = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await throwaway.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;

  // 検証用に発行したセッションはこのクライアントのメモリから捨てる（scope: 'local'。
  // 'global' にすると操作者本人のブラウザセッションまで失効する）。GoTrue 側のセッション行は
  // 有効期限で自然に消えるため、ここでは追加の失効処理をしない。失敗しても検証結果には影響しない。
  await throwaway.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return true;
};

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
