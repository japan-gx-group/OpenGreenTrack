// ログイン・初回登録・招待の成功後に遷移する先を、オープンリダイレクト対策付きで解決する。
// ?next= が「安全な相対パス」ならそれを、そうでなければ /dashboard を返す。
// ログイン/登録/招待の3画面で共通利用する（LoginForm 由来のロジックをここに集約）。
export const getSafeRedirectPath = (nextPath: string | null): string => {
  // 先頭が単一の '/' で、直後が '/' でも '\' でもない相対パスのみ許可する。
  // '//evil.com' や '/\evil.com' はブラウザで protocol-relative な外部URLに解決されるため弾く。
  if (!nextPath || !/^\/(?![/\\])/.test(nextPath)) {
    return '/dashboard';
  }

  return nextPath;
};
