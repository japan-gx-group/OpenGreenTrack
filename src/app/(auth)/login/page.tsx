import { Suspense } from 'react';
import { getSetupState } from '@/features/auth/services/setup';
import { LoginForm } from '@/features/auth/components/LoginForm.client';

// admin client（service_role）で組織有無を確認するため、ビルド時の事前生成を避けて
// 常にリクエスト時に実行する。
export const dynamic = 'force-dynamic';

// 認証済みユーザーの /dashboard へのリダイレクトは proxy.ts で一元的に行うため、
// このページでは getUser() を重ねず LoginForm を描画するだけにする。
// LoginForm は useSearchParams() を使うため Suspense 境界で包む。
export default async function LoginPage() {
  // 「初期セットアップ」リンクは未セットアップ環境でだけ意味を持つ導線のため、
  // サーバ側でセットアップ状態を判定して表示を切り替える（セットアップ済みでは
  // /signup 側のガードで弾き返されるだけのノイズになる）。
  // 'unknown'（判定不能）は表示に倒す。環境変数の不備などで判定できない新規環境では、
  // リンク経由で /signup を開いたときの「セットアップ状態を確認できませんでした」が
  // 唯一の診断導線になるため（非表示にすると原因に辿り着けない）。実行可否そのものは
  // /signup 側の二重ガードが引き続き守る。
  const showSetupLink = (await getSetupState()) !== 'completed';
  return (
    <Suspense>
      <LoginForm showSetupLink={showSetupLink} />
    </Suspense>
  );
}
