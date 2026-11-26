// SSBJ の画面が呼ぶ API（/api/ssbj/...）の失敗を、利用者が次に何をすればよいか分かる文にする。
// サーバの文が具体的なとき（競合・入力の誤り・見つからないなど）はそのまま出し、
// 「サーバー内部エラーが発生しました」のような原因の分からない失敗・ログイン切れ・権限不足のときだけ、次の一手を添える。
// サーバの文が無いときは、ステータスで文を分ける。「サーバーで問題が起きました」と言うのは 5xx だけにする
// （見つからない 404・入力の誤りの 400・通信できない 0 をサーバの問題と書くと、利用者が待つだけで直らないため）。

/** サーバが原因を言えない失敗のときにサーバが返す文（app/api の各 Route Handler と同じ）。 */
const GENERIC_SERVER_ERROR = 'サーバー内部エラーが発生しました';

/**
 * @param status 応答の HTTP ステータス（通信できなかったときは 0）
 * @param body 応答の JSON（読めなければ null）
 * @param action 失敗した操作の文（例: 「プレビューの取得に失敗しました」）。原因が分からないときの文頭に使う
 */
export const ssbjApiErrorMessage = (status: number, body: { error?: unknown } | null, action: string): string => {
  const serverMessage = typeof body?.error === 'string' && body.error.trim() !== '' ? body.error : null;
  if (status === 401) {
    return `${action}。ログインの有効期限が切れています。ログインし直してから、もう一度お試しください`;
  }
  if (status === 403) {
    return `${serverMessage ?? `${action}。この操作の権限がありません`}。必要なら、管理者に SSBJ のロールの確認を頼んでください`;
  }
  if (serverMessage && serverMessage !== GENERIC_SERVER_ERROR) return serverMessage;
  if (status === 404) {
    return `${action}。見つかりませんでした。削除されたか、開いている画面が古い可能性があります。一覧から開き直してください`;
  }
  if (status === 400) {
    return `${action}。入力の内容を確かめてください（空の欄・字数・形式など）。直しても続くときは管理者に連絡してください`;
  }
  if (status >= 500) {
    return `${action}（サーバーで問題が起きました）。少し待ってから「読み直す」か画面を開き直してください。続くときは管理者に連絡してください`;
  }
  if (status === 0) {
    return `${action}（通信できませんでした）。ネットワークの接続を確かめてから、もう一度お試しください`;
  }
  return `${action}。画面を開き直して、もう一度お試しください。続くときは管理者に連絡してください`;
};
