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

/**
 * 共通の入口（generateStructured）の失敗の分類。提供元の失敗（AiErrorCode）に、
 * 送る前にアプリ側で断る理由を足したもの。
 */
export type AiGenerateErrorCode =
  | AiErrorCode
  /** 環境変数に提供元・鍵が無い・不正 */
  | 'not_configured'
  /** 管理者がモデルを選んでいない（または提供元を替えてモデルが無効になった） */
  | 'model_not_selected'
  /** 登録していない用途から呼ばれた */
  | 'unknown_purpose'
  /** 用途の範囲外の入力（種類・形式・量） */
  | 'invalid_input'
  /** 回数の上限（用途ごと・組織全体）を超えた */
  | 'limit_exceeded';

/** AI の設定の状態（GET /api/ai/status の応答）。鍵の値・暗号文は含めない */
export interface AiStatus {
  /** 鍵の置き場所。'server' = 環境変数（方式A）、'app' = 画面から登録（方式B） */
  keySource: 'server' | 'app';
  /** 提供元と鍵が使える状態か（方式A: 環境変数が正しい / 方式B: 登録済みで復号できる） */
  configured: boolean;
  /** 使う提供元。未設定・未登録なら null */
  provider: AiProviderId | null;
  /** 選択中のモデル ID。未選択、または提供元が変わって無効になったら null */
  modelId: string | null;
  /** ログイン中の人が AI の設定を変えられるか（管理者か） */
  canManage: boolean;
  /** 方式B: 画面から登録してよい提供元（方式A では空） */
  allowedProviders: AiProviderId[];
  /** 方式B: 登録済みの鍵（末尾 4 文字と更新日時）。未登録なら null */
  registeredKey: { provider: AiProviderId; last4: string; updatedAt: string } | null;
  /** 方式B: 暗号化の鍵を替えた・許可されない提供元になったなどで、登録し直しが必要 */
  needsReRegistration: boolean;
  /** 方式A: 以前に方式B で登録した鍵が DB に残っている（削除できる） */
  leftoverKey: boolean;
}
