// AI 連携の画面に出す文言（サーバの応答とブラウザの表示で共有する）。
// 提供元のエラーの本文は出さず、分類（AiErrorCode）ごとの決まった文だけを出す。

import type { AiErrorCode, AiGenerateErrorCode } from '@/types/ai';

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  invalid_key: 'API キーが無効か、権限がありません。サーバに設定した API キーを確認してください',
  billing: '提供元の利用枠か支払いの設定を確認してください',
  rate_limited: '提供元の利用上限に達しました。時間をおいてお試しください',
  overloaded: '提供元が混み合っています。時間をおいてお試しください',
  model_unavailable: '選択中のモデルが使えません。モデルを選び直してください',
  input_rejected: '提供元が要求を受け付けませんでした',
  timeout: '時間内に応答がありませんでした。時間をおいてお試しください',
  bad_response: '提供元の応答を解釈できませんでした',
  unknown: 'AI の提供元の呼び出しに失敗しました',
};

export const AI_NOT_CONFIGURED_MESSAGE =
  'AI はまだ使えません。サーバの環境変数に提供元と API キーを設定してください（設定が不足しているか、値が正しくありません）';

export const AI_MODEL_LIST_RATE_LIMITED_MESSAGE =
  'モデルの一覧の取得が続いています。1 分ほどおいてお試しください';

/** AI を使う機能（共通の入口）の失敗のときに出す文 */
export const AI_GENERATE_ERROR_MESSAGES: Record<AiGenerateErrorCode, string> = {
  ...AI_ERROR_MESSAGES,
  invalid_key: 'AI の API キーが無効か、権限がありません。管理者に確認してください',
  model_unavailable: '選択中の AI のモデルが使えません。管理者が「AI の設定」でモデルを選び直してください',
  bad_response: 'AI の結果を解釈できませんでした。手で入力してください',
  not_configured: 'AI はまだ使えません。管理者に確認してください',
  model_not_selected: 'AI のモデルが選ばれていません。管理者が企業・メンバー設定の「AI の設定」でモデルを選んでください',
  unknown_purpose: 'この機能では AI を使えません',
  invalid_input: '送る内容が正しくありません',
  limit_exceeded: 'AI の利用回数の上限に達しました。時間をおいてお試しください',
};

/** 方式B の鍵の問題（管理者が「AI の設定」で見る文） */
export const AI_CREDENTIAL_PROBLEM_MESSAGES = {
  credential_missing: 'API キーがまだ登録されていません。「AI の設定」で登録してください',
  credential_unreadable: '暗号化の鍵が変わったため、登録した API キーを読めません。API キーを登録し直してください',
  credential_provider_not_allowed:
    '登録した API キーの提供元は、今は使えない設定になっています。許可されている提供元の API キーを登録し直してください',
} as const;
