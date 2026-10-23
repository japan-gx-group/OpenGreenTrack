// AI 連携でブラウザとサーバが共有する型と値（鍵などの秘密は含めない）。
// AI は複数の機能（請求書の読取り・開示文の下書きなど）から使うため、全体共有の型としてここに置く（AGENTS.md R3）。
// 鍵の読み取りと提供元への送信はサーバ専用の src/lib/ai/ が行う。

export const AI_PROVIDER_IDS = ['anthropic', 'google', 'openai'] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: 'Anthropic（Claude）',
  google: 'Google（Gemini）',
  openai: 'OpenAI（ChatGPT）',
};

export const isAiProviderId = (value: unknown): value is AiProviderId =>
  typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value);

// 保存・送信に使うモデル ID の形。'/'・':'・'?'・'#'・空白を入れさせない
// （Gemini はモデル ID が URL のパスに入るため、別の API へ向け直されないようにする）。
export const AI_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const isValidAiModelId = (value: unknown): value is string =>
  typeof value === 'string' && AI_MODEL_ID_PATTERN.test(value);

/** プルダウンに並べるモデル（提供元のモデル一覧を、使えるものに絞って揃えた形） */
export interface AiModelOption {
  /** 保存・送信に使う ID（Gemini は "models/" を外したもの） */
  id: string;
  /** 表示名（提供元が表示名を返さない場合は ID） */
  displayName: string;
  /** 作成日時（ISO 8601）。提供元が返さない場合は null */
  createdAt: string | null;
  /** 廃止予定か */
  deprecated: boolean;
  /** 廃止予定日（YYYY-MM-DD）。分からなければ null */
  retiresOn: string | null;
}

/** 提供元の呼び出しの失敗の分類（提供元ごとの HTTP エラーをここへ揃える） */
export type AiErrorCode =
  | 'invalid_key'
  | 'billing'
  | 'rate_limited'
  | 'overloaded'
  | 'model_unavailable'
  | 'input_rejected'
  | 'timeout'
  | 'bad_response'
  | 'unknown';

/** AI の設定の状態（GET /api/ai/status の応答） */
export interface AiStatus {
  /** 鍵の置き場所。今は環境変数（方式A）だけ */
  keySource: 'server';
  /** 提供元と鍵がサーバに正しく設定されているか */
  configured: boolean;
  /** 設定されている提供元。未設定・不正なら null */
  provider: AiProviderId | null;
  /** 選択中のモデル ID。未選択、または提供元が変わって無効になったら null */
  modelId: string | null;
  /** ログイン中の人が AI の設定を変えられるか（管理者か） */
  canManage: boolean;
}
