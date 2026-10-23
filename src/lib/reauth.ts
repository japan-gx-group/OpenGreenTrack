// 本人確認（ログインパスワードの再入力）の共通の処理（サーバ専用）。
// パスワード変更（src/features/settings/services/password.ts）と、AI の鍵の登録・削除
// （src/features/ai/services/aiCredentialActions.ts）で使う。
//
// ログインしていても、いま操作しているのが本人とは限らない（席を外した間の PC・盗まれたログイン状態）。
// 被害の大きい操作の前に、ログインパスワードをもう一度確かめる。本人確認をクライアントに任せない
// （ブラウザでの signInWithPassword の結果を信用しない）ため、必ずサーバで行う。
// 入力されたパスワードは保存しない・ログに出さない。何度も試す攻撃には Supabase Auth のログイン試行の制限が効く。

import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// 現在のパスワードが正しいかを signInWithPassword で検証する。
// Cookie セッション用のクライアント（@/lib/supabase/server）で呼ぶと、検証で発行された
// 新しいセッションが Cookie に書き戻されて操作者のセッションが差し替わってしまうため、
// セッションを永続化しない使い捨てクライアント（anon key）で行う。
export const verifyCurrentPassword = async (email: string, password: string): Promise<boolean> => {
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
