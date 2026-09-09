'use server';

// パスワード再設定（メールの再設定リンク経由）の完了処理の Server Action。
//
// なぜサーバ側で行うか:
//   supabase/config.toml の auth.secure_password_change を有効にすると、GoTrue は
//   ブラウザからの auth.updateUser({ password }) を拒否する。再設定リンク経由のユーザーは
//   現在のパスワードを知らない（だから再設定する）ので再認証もできず、更新は
//   service_role の admin API（updateUserById）でしか行えない。
//
// 前提条件（どちらも満たさなければ更新しない）:
//   1. Cookie セッションがある（/auth/callback の exchangeCodeForSession で確立した recovery セッション）
//   2. pw-recovery マーカー Cookie がある（同じく /auth/callback が張る。httpOnly のため
//      ブラウザの JS からは作れない＝メールリンクを踏んだことの証明になる）
//   ただログイン中の人が /reset-password を開いても proxy.ts で弾かれるが、Server Action は
//   URL を経由せず直接呼べるため、ここでも独立にマーカーを確認する。
//
// 更新対象は必ず Cookie セッションのユーザー自身に固定する（入力の id 等は受け取らない）。

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/types/actionResult';
import { RECOVERY_MARKER_COOKIE } from '@/features/auth/utils/passwordRecoveryCookie';

const MIN_PASSWORD_LENGTH = 8;

export const completePasswordRecovery = async (newPassword: string): Promise<ActionResult> => {
  const password = String(newPassword ?? '');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。` };
  }

  const cookieStore = await cookies();
  if (cookieStore.get(RECOVERY_MARKER_COOKIE)?.value !== '1') {
    return {
      ok: false,
      error: '再設定リンクの有効期限が切れています。ログイン画面から再度お試しください。',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      error: '再設定リンクの有効期限が切れています。ログイン画面から再度お試しください。',
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password });
  if (error) {
    return { ok: false, error: 'パスワードの更新に失敗しました' };
  }

  // マーカーは一度きり。更新が済んだら消して、同じ recovery セッションで再度
  // /reset-password を開いたり本 Action を呼び直したりできないようにする。
  cookieStore.delete(RECOVERY_MARKER_COOKIE);

  return { ok: true, data: undefined };
};
