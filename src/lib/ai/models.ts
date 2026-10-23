// 使えるモデルの一覧の取得（サーバ専用）。GET /api/ai/models とモデルの保存（saveAiModel）の両方が使う。
//
// 設定（環境変数）の確認 → 回数の上限 → 提供元のモデル一覧 API の順に行う。鍵はここから外へ出さない。
// 管理者の確認は呼び出し側（Route Handler・Server Action）で先に行うこと。

import 'server-only';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';
import type { AiModelOption, AiProviderId } from '@/types/ai';
import {
  AI_ERROR_MESSAGES,
  AI_MODEL_LIST_RATE_LIMITED_MESSAGE,
  AI_NOT_CONFIGURED_MESSAGE,
} from '@/features/ai/messages';
import { readAiConfig, type AiConfigProblem } from './config';
import { AiProviderError, getAiProvider } from './providers';

// 提供元の制限に当たらないよう、組織ごとに 1 分 10 回までにする（プロセス内のカウンタ。src/lib/security/rateLimit.ts）。
export const MODEL_LIST_LIMIT_PER_MINUTE = 10;
const modelListLimiter = createFixedWindowRateLimiter({
  limit: MODEL_LIST_LIMIT_PER_MINUTE,
  windowMs: 60_000,
});

export type ListModelsResult =
  | { ok: true; provider: AiProviderId; models: AiModelOption[] }
  | {
      ok: false;
      status: 429 | 502 | 503;
      error: string;
      /** ログに残す理由（設定の不足の種類・提供元のエラーの分類）。画面には出さない */
      reason: AiConfigProblem | AiProviderError['code'] | 'local_rate_limited';
    };

export const listAvailableModels = async (
  organizationId: string,
  signal?: AbortSignal,
): Promise<ListModelsResult> => {
  const config = readAiConfig();
  if (!config.ok) {
    return { ok: false, status: 503, error: AI_NOT_CONFIGURED_MESSAGE, reason: config.problem };
  }

  if (!modelListLimiter.consume(organizationId)) {
    return {
      ok: false,
      status: 429,
      error: AI_MODEL_LIST_RATE_LIMITED_MESSAGE,
      reason: 'local_rate_limited',
    };
  }

  try {
    const models = await getAiProvider(config.provider).listModels(config.apiKey, signal);
    return { ok: true, provider: config.provider, models };
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : 'unknown';
    return { ok: false, status: 502, error: AI_ERROR_MESSAGES[code], reason: code };
  }
};

/** テスト用。回数の上限のカウンタを空にする */
export const resetModelListLimiterForTest = () => modelListLimiter.reset();
