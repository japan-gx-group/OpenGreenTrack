// AI 連携の画面に出す文言（サーバの応答とブラウザの表示で共有する）。
// 提供元のエラーの本文は出さず、分類（AiErrorCode）ごとの決まった文だけを出す。

import type { AiErrorCode } from '@/types/ai';

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
