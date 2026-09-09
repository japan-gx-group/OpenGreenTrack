// アカウント（個人プロフィール / パスワード / 退会）のサービス。
// Supabase のブラウザクライアント（RLS 前提）を使い、パスワード変更は Server Action、
// 退会はサーバ Route Handler に委譲する（どちらも service_role が必要なため）。
import { createClient } from '@/lib/supabase/client';
import type { CurrentProfile } from '../types';
import { changePassword } from './password';

interface ProfileRow {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  organizationId: string;
}

// ログイン中ユーザーのプロフィールを取得する。
export const getCurrentProfile = async (): Promise<CurrentProfile> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('ログイン情報が確認できませんでした。再度ログインしてください');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, fullName, phone, organizationId')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    throw new Error('プロフィールの取得に失敗しました');
  }

  const row = data as ProfileRow;
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName ?? '',
    phone: row.phone ?? '',
    organizationId: row.organizationId,
  };
};

// 氏名・電話番号を更新する（メール・権限は本画面では変更しない）。
export const updateProfile = async (input: {
  fullName: string;
  phone: string;
}): Promise<void> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('ログイン情報が確認できませんでした。再度ログインしてください');
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      fullName: input.fullName.trim() || null,
      phone: input.phone.trim() || null,
    })
    .eq('id', user.id);

  if (error) {
    throw new Error('プロフィールの保存に失敗しました');
  }
};

// パスワードを変更する。
// 現在のパスワードの検証と新パスワードの反映はサーバ（Server Action）で行う。
// ブラウザの auth.updateUser({ password }) は secure_password_change 有効時に GoTrue が拒否するため、
// 本人確認（現在のパスワードによる再認証）も含めてサーバ側で完結させる（password.ts のコメント参照）。
export const updatePassword = async (input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> => {
  const result = await changePassword(input);
  if (!result.ok) {
    throw new Error(result.error);
  }
};

// アカウントを削除する。auth ユーザーの削除は service_role が必要なため、
// サーバの Route Handler（POST /api/account/delete）に委譲する。
// 削除後はブラウザ側のセッションもサインアウトする。
export const deleteAccount = async (): Promise<void> => {
  const res = await fetch('/api/account/delete', { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'アカウントの削除に失敗しました');
  }
  const supabase = createClient();
  await supabase.auth.signOut();
};
