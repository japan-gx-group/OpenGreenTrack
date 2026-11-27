// 拠点の書き込み（CSVインポートの一括登録・更新）で返る PostgREST / Postgres のエラーを、
// 取込画面の行エラー欄にそのまま出せる日本語へ変換する。
// 判定は英語の文面ではなく error.code で行う（ライブラリ更新で文面が変わっても結果を変えないため）。

/** 書き込みの種類。同じエラーコードでも操作によって意味が変わるものがあるため区別する。 */
export type LocationWriteAction = 'create' | 'update';

/** supabase-js が返すエラーのうち、変換に使う部分だけ（テストで素のオブジェクトを渡せるよう構造で受ける）。 */
export interface LocationWriteErrorLike {
  code?: string;
  message?: string;
}

// ログインが切れたときのコード。
// - PGRST301 / PGRST303: アクセストークン（JWT）が無効、またはクレームの検証に失敗した（期限切れを含む）
// - 42501: トークンが無く anon として送られた。locations は anon に何も GRANT しておらず、
//   ログイン中（authenticated）なら RLS は組織一致のみを見るため、自組織への書き込みでは起こらない
// どれも「権限が無い」のではなく、ログインし直せば解消するので、その案内を出す。
const SESSION_EXPIRED_CODES = new Set(['PGRST301', 'PGRST303', '42501']);
const SESSION_EXPIRED_MESSAGE =
  'ログイン情報が確認できませんでした。再度ログインしてから取り込み直してください';

// update().eq('id', …).single() が0件にマッチしたときのコード。
// プレビューから実行までの間に、対象の拠点が削除された場合に起こる（削除したのが自分の別タブのこともある）。
// insert では対象が消えることはないため、更新のときだけこの案内を出す。
// 再読み込み後に取り込み直すと、その行は「追加」として計画される。それをプレビューで確かめてもらう。
const NO_ROWS_CODE = 'PGRST116';
const UPDATE_TARGET_MISSING_MESSAGE =
  '更新対象の拠点が見つかりません。取込の確認後に削除された可能性があります。一覧を再読み込みし、プレビューを確認してから取り込み直してください';

const FALLBACK_MESSAGES: Record<LocationWriteAction, string> = {
  create: '拠点の登録に失敗しました',
  update: '拠点の更新に失敗しました',
};

export const toLocationWriteErrorMessage = (
  error: LocationWriteErrorLike | null | undefined,
  action: LocationWriteAction,
): string => {
  const code = error?.code;
  if (code && SESSION_EXPIRED_CODES.has(code)) return SESSION_EXPIRED_MESSAGE;
  if (action === 'update' && code === NO_ROWS_CODE) return UPDATE_TARGET_MISSING_MESSAGE;

  // 文字数・選択肢（地域・種別・状態）は取込のプレビュー時に検証済みのため、DB の制約違反はここでは想定しない。
  // 想定外のエラーは握りつぶさず、元のメッセージを詳細として残す（問い合わせ時の手がかりにする）。
  const fallback = FALLBACK_MESSAGES[action];
  return error?.message ? `${fallback}（詳細: ${error.message}）` : fallback;
};
