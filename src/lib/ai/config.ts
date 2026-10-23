// AI 連携の設定（環境変数）の読み取りと検証（サーバ専用）。
//
// 鍵の置き場所は、今は環境変数（方式A）だけ。判定はリクエストのたびにこの関数で行う
// （サーバレスの環境では起動時の処理を当てにできないため）。設定が足りない・不正なときは
// 「AI を使えない状態」に倒し、理由はサーバのログにだけ出す（画面には不足しているとだけ伝える）。
//
// ⚠️ AI_API_KEY は秘密情報。NEXT_PUBLIC_ を付けない・ブラウザへ返さない・ログに出さないこと（AGENTS.md R7）。

import 'server-only';
import { isAiProviderId, type AiProviderId } from '@/types/ai';

export type AiConfigProblem =
  /** AI_PROVIDER・AI_API_KEY のどちらかが無い（AI を使わない環境） */
  | 'not_configured'
  /** AI_PROVIDER が anthropic / google / openai のどれでもない */
  | 'invalid_provider'
  /** AI_API_KEY の形が不正（空白・改行・長さ） */
  | 'invalid_key'
  /** AI_ALLOW_KEY_REGISTRATION（画面からの鍵の登録）はまだ使えない */
  | 'registration_not_supported'
  /** AI_ALLOW_KEY_REGISTRATION が true / false のどちらでもない */
  | 'invalid_registration_flag';

export type AiConfig =
  | { ok: true; keySource: 'server'; provider: AiProviderId; apiKey: string }
  | { ok: false; problem: AiConfigProblem };

// ヘッダに入れる値なので、印字できる ASCII 文字だけにする（改行などでヘッダを分けさせない）。
// 先頭の文字（sk-ant- など）では判定しない（提供元が鍵の形を変えることがあるため）。
const API_KEY_PATTERN = /^[\x21-\x7e]{8,512}$/;

export const isValidAiApiKey = (value: string): boolean => API_KEY_PATTERN.test(value);

type AiEnv = Readonly<Record<string, string | undefined>>;

export const readAiConfig = (env: AiEnv = process.env): AiConfig => {
  const registration = env.AI_ALLOW_KEY_REGISTRATION?.trim();
  if (registration && registration !== 'false') {
    // 画面からの鍵の登録（方式B）は後続で作る。それまでは true を指定されても使えない側に倒す。
    return {
      ok: false,
      problem: registration === 'true' ? 'registration_not_supported' : 'invalid_registration_flag',
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
