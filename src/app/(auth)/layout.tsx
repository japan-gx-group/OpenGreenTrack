import type { ReactNode } from 'react';
import { AuthLayout } from '@/features/auth/components/AuthLayout';

// 認証画面（ログイン / 初期セットアップ / 招待受諾 / パスワード再設定）のルートグループ。
// URL には現れない。ブランドパネル + フォーム面の2カラムシェルをここで 1 回だけ描き、
// 各ページは AuthFormFrame で包んだフォーム本体だけを返す。
// サイドバー用の Context は乗せない（未ログインでは読めないデータを取りに行くだけになる）。
// このグループに画面を足したら、src/lib/security/authPaths.ts の公開パス一覧も更新すること。
export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}
