// AI 連携の設定（環境変数）の読み取りと検証（サーバ専用）。
//
// 鍵の置き場所は 2 つの方式から選ぶ。どちらにするかは環境変数だけで決め、画面からは切り替えられない
// （ログイン中のアカウントを乗っ取った人が、自分で方式B を有効にして鍵を登録できないようにするため）。
//   方式A（既定）: AI_PROVIDER / AI_API_KEY に置く。画面からは変えられない
//   方式B: AI_ALLOW_KEY_REGISTRATION=true。管理者が画面から登録し、DB に暗号化して置く（暗号化の鍵は AI_ENCRYPTION_KEY）
// 判定はリクエストのたびにこの関数で行う（サーバレスの環境では起動時の処理を当てにできないため）。
// 設定が足りない・不正なときは「AI を使えない状態」に倒し、理由はサーバのログにだけ出す。
// 暗号化の鍵が無いときに、暗号化せずに保存する方向へは倒さない。
//
// ⚠️ AI_API_KEY・AI_ENCRYPTION_KEY は秘密情報。NEXT_PUBLIC_ を付けない・ブラウザへ返さない・ログに出さないこと（AGENTS.md R7）。

import 'server-only';
import { AI_PROVIDER_IDS, isAiProviderId, type AiProviderId } from '@/types/ai';
import { encryptionKeyId, parseEncryptionKey } from './crypto';

export type AiConfigProblem =
  /** 方式A で AI_PROVIDER・AI_API_KEY のどちらかが無い（AI を使わない環境） */
  | 'not_configured'
  /** AI_PROVIDER が anthropic / google / openai のどれでもない */
  | 'invalid_provider'
  /** AI_API_KEY の形が不正（空白・改行・長さ） */
  | 'invalid_key'
  /** AI_ALLOW_KEY_REGISTRATION が true / false のどちらでもない */
  | 'invalid_registration_flag'
  /** 方式B で AI_ENCRYPTION_KEY が無い・32 バイトの base64 でない */
  | 'invalid_encryption_key'
  /** AI_ALLOWED_PROVIDERS に対応していない提供元が入っている */
  | 'invalid_allowed_providers';

export type AiConfig =
  | { ok: true; keySource: 'server'; provider: AiProviderId; apiKey: string }
  | {
      ok: true;
      keySource: 'app';
      encryptionKey: Buffer;
      encryptionKeyId: string;
      /** 画面から登録してよい提供元 */
      allowedProviders: AiProviderId[];
      /** 方式B なのに AI_API_KEY も設定されている（読まない。運用担当が気づけるようログに出す） */
      ignoresServerKey: boolean;
    }
  | { ok: false; problem: AiConfigProblem };

// ヘッダに入れる値なので、印字できる ASCII 文字だけにする（改行などでヘッダを分けさせない）。
// 先頭の文字（sk-ant- など）では判定しない（提供元が鍵の形を変えることがあるため）。
const API_KEY_PATTERN = /^[\x21-\x7e]{8,512}$/;

export const isValidAiApiKey = (value: string): boolean => API_KEY_PATTERN.test(value);

type AiEnv = Readonly<Record<string, string | undefined>>;

const parseAllowedProviders = (value: string | undefined): AiProviderId[] | null => {
  const trimmed = value?.trim();
  if (!trimmed) return [...AI_PROVIDER_IDS];
  const names = trimmed.split(',').map((name) => name.trim()).filter(Boolean);
  if (names.length === 0 || !names.every(isAiProviderId)) return null;
  return AI_PROVIDER_IDS.filter((id) => names.includes(id));
};

export const readAiConfig = (env: AiEnv = process.env): AiConfig => {
  const registration = env.AI_ALLOW_KEY_REGISTRATION?.trim();
  if (registration && registration !== 'true' && registration !== 'false') {
    return { ok: false, problem: 'invalid_registration_flag' };
  }

  if (registration === 'true') {
    const encryptionKey = parseEncryptionKey(env.AI_ENCRYPTION_KEY);
    if (!encryptionKey) {
      return { ok: false, problem: 'invalid_encryption_key' };
    }
    const allowedProviders = parseAllowedProviders(env.AI_ALLOWED_PROVIDERS);
    if (!allowedProviders) {
      return { ok: false, problem: 'invalid_allowed_providers' };
    }
    return {
      ok: true,
      keySource: 'app',
      encryptionKey,
      encryptionKeyId: encryptionKeyId(encryptionKey),
      allowedProviders,
      ignoresServerKey: Boolean(env.AI_API_KEY?.trim()),
    };
  }

  const provider = env.AI_PROVIDER?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  if (!provider || !apiKey) {
    return { ok: false, problem: 'not_configured' };
  }
  if (!isAiProviderId(provider)) {
    return { ok: false, problem: 'invalid_provider' };
  }
  if (!isValidAiApiKey(apiKey)) {
    return { ok: false, problem: 'invalid_key' };
  }
  return { ok: true, keySource: 'server', provider, apiKey };
};
