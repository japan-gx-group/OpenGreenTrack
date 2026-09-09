// 認証系パス（未ログインでもアクセス可）の判定。src/proxy.ts（ミドルウェア）が
// 「未ログインなら /login へ」「ログイン済みなら /dashboard へ」の振り分けに使う。
// サイドバーの出し分けはルートグループ（src/app/(app) と src/app/(auth)）が担うため
// ここでは行わない。ミドルウェアはディレクトリ構成を知らないので、この一覧は
// src/app/(auth)/ 配下の画面と手で一致させる（画面を足したらここも足す）。
export const isAuthPath = (pathname: string): boolean =>
  pathname === '/login' ||
  pathname === '/signup' ||
  pathname === '/forgot-password' ||
  pathname === '/reset-password' ||
  pathname.startsWith('/invite/');
