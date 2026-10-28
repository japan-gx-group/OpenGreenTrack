// 使えるモデルの一覧の取得（サーバ専用）。GET /api/ai/models・モデルの保存（saveAiModel）・
// 鍵の登録（saveAiCredential。登録する鍵が使えるかの確認）が使う。
//
// 鍵の取り出し（方式A: 環境変数 / 方式B: DB を復号）→ 回数の上限 → 提供元のモデル一覧 API の順に行う。鍵はここから外へ出さない。
// 管理者の確認は呼び出し側（Route Handler・Server Action）で先に行うこと。

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';
import type { AiModelOption, AiProviderId } from '@/types/ai';
import {
  AI_CREDENTIAL_PROBLEM_MESSAGES,
  AI_ERROR_MESSAGES,
  AI_MODEL_LIST_RATE_LIMITED_MESSAGE,
  AI_NOT_CONFIGURED_MESSAGE,
} from '@/features/ai/messages';
import { resolveAiCredential, type AiCredentialProblem } from './credentials';
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
      /** ログに残す理由（設定・鍵の問題の種類・提供元のエラーの分類）。画面には出さない */
      reason: AiCredentialProblem | AiProviderError['code'] | 'local_rate_limited';
    };

const credentialProblemMessage = (problem: AiCredentialProblem): string =>
  problem in AI_CREDENTIAL_PROBLEM_MESSAGES
    ? AI_CREDENTIAL_PROBLEM_MESSAGES[problem as keyof typeof AI_CREDENTIAL_PROBLEM_MESSAGES]
    : AI_NOT_CONFIGURED_MESSAGE;

/** 指定した鍵で一覧を取る（回数の上限を数える）。登録しようとしている鍵が使えるかの確認にも使う */
export const listModelsWithKey = async (
  organizationId: string,
  provider: AiProviderId,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ListModelsResult> => {
  if (!modelListLimiter.consume(organizationId)) {
    return {
      ok: false,
      status: 429,
      error: AI_MODEL_LIST_RATE_LIMITED_MESSAGE,
      reason: 'local_rate_limited',
    };
  }
  try {
    const models = await getAiProvider(provider).listModels(apiKey, signal);
    return { ok: true, provider, models };
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : 'unknown';
    return { ok: false, status: 502, error: AI_ERROR_MESSAGES[code], reason: code };
  }
};

/** 組織の今の鍵（方式A: 環境変数 / 方式B: 登録した鍵）で一覧を取る */
export const listAvailableModels = async (
  organizationId: string,
  signal?: AbortSignal,
): Promise<ListModelsResult> => {
  const credential = await resolveAiCredential(createAdminClient(), organizationId);
  if (!credential.ok) {
    return { ok: false, status: 503, error: credentialProblemMessage(credential.problem), reason: credential.problem };
  }
  return listModelsWithKey(organizationId, credential.provider, credential.apiKey, signal);
};

/** テスト用。回数の上限のカウンタを空にする */
export const resetModelListLimiterForTest = () => modelListLimiter.reset();
