// AI の共通の入口（サーバ専用）。AI を使う機能は、提供元の API を直接呼ばず、必ずこの関数を通す。
//
// 処理の順番:
//   1. 用途が登録済みか（purposes.ts）。出力の形（JSON スキーマ）が 3 社で使える書き方か（schema.ts）
//   2. 入力が用途の範囲内か（種類・量）。ファイルの形式を先頭のバイトで確かめる（inputCheck.ts）
//   3. 設定（環境変数の提供元・鍵）と、管理者が選んだモデル（ai_settings）を読む
//   4. 回数の上限（用途ごと・組織全体。rateLimit.ts）
//   5. 提供元に送る（ツールは渡さない。提供元に保存させない）
//   6. 機能側の validate で出力を検証する（形が合わない・値の範囲外なら使わない）
//   7. 監査ログに残す（auditLog.ts。5 に進んだ呼び出しは成功・失敗とも）
//
// 呼び出し側（機能の Route Handler）が、ログイン済みであることと組織を確かめてから呼ぶこと（profile は
// getCurrentProfile() の結果を渡す。組織 ID はリクエストから受け取らない）。AI の出力はそのまま確定データにせず、
// 画面で「候補」として見せて、保存は人が行う。出力は文字として表示する（HTML として解釈しない）。

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import type { CurrentProfile } from '@/lib/currentProfile';
import { AI_GENERATE_ERROR_MESSAGES } from '@/features/ai/messages';
import type { AiGenerateErrorCode, AiProviderId } from '@/types/ai';
import { readAiConfig } from './config';
import { prepareAiInputs, type AiInputPart } from './inputCheck';
import { AiProviderError, getAiProvider } from './providers';
import { findAiPurpose, type AiPurposeId } from './purposes';
import { checkAiRateLimit } from './rateLimit';
import { recordAiRequest } from './auditLog';
import { findPortableSchemaProblems, type AiJsonSchema } from './schema';

export interface GenerateStructuredArgs<T> {
  /** 登録済みの用途（purposes.ts） */
  purpose: AiPurposeId;
  /** getCurrentProfile() の結果。組織 ID はここから取る */
  profile: Pick<CurrentProfile, 'id' | 'organizationId'>;
  /** 機能が決める固定の指示文。利用者が入力した文は混ぜず、input の text で渡す */
  instructions: string;
  /** 送るもの（必要なものだけ） */
  input: AiInputPart[];
  /** 出力の形 */
  schema: AiJsonSchema;
  /** 機能側の検証。形が合わない・値が範囲外なら null を返す（bad_response になる） */
  validate: (value: unknown) => T | null;
  signal?: AbortSignal;
}

export type AiResult<T> =
  | { ok: true; value: T; provider: AiProviderId; modelId: string }
  | { ok: false; code: AiGenerateErrorCode; message: string; retryAfterSeconds?: number };

const fail = (
  code: AiGenerateErrorCode,
  extra: { message?: string; retryAfterSeconds?: number } = {},
): { ok: false; code: AiGenerateErrorCode; message: string; retryAfterSeconds?: number } => ({
  ok: false,
  code,
  message: extra.message ?? AI_GENERATE_ERROR_MESSAGES[code],
  ...(extra.retryAfterSeconds !== undefined && { retryAfterSeconds: extra.retryAfterSeconds }),
});

export const generateStructured = async <T>(args: GenerateStructuredArgs<T>): Promise<AiResult<T>> => {
  const log = (await getRequestLogger()).child({ aiPurpose: args.purpose });

  const purpose = findAiPurpose(args.purpose);
  if (!purpose) {
    log.error('登録していない用途から AI が呼ばれました');
    return fail('unknown_purpose');
  }

  const schemaProblems = findPortableSchemaProblems(args.schema);
  if (schemaProblems.length > 0) {
    // 機能側の書き方の誤り（開発時に気づくべきもの）。利用者には送る内容が正しくないとだけ伝える。
    log.error({ schemaProblems }, 'AI の出力の形（JSON スキーマ）が 3 社で使える書き方になっていません');
    return fail('invalid_input');
  }

  const prepared = prepareAiInputs(purpose, args.input);
  if (!prepared.ok) {
    return fail('invalid_input', { message: `${AI_GENERATE_ERROR_MESSAGES.invalid_input}（${prepared.reason}）` });
  }

  const config = readAiConfig();
  if (!config.ok) {
    log.warn({ problem: config.problem }, 'AI の設定（環境変数）が不足しているか、正しくありません');
    return fail('not_configured');
  }

  const admin = createAdminClient();
  const { data: settings, error: settingsError } = await admin
    .from('ai_settings')
    .select('provider, modelId')
    .eq('organizationId', args.profile.organizationId)
    .maybeSingle();
  if (settingsError) {
    log.error({ error: settingsError }, 'AI の設定の取得に失敗しました');
    return fail('unknown');
  }
  // 選んだ時点の提供元が今の提供元と違えば、モデルは無効（選び直してもらう）。
  if (!settings || settings.provider !== config.provider) {
    return fail('model_not_selected');
  }
  const modelId = settings.modelId as string;

  const limit = await checkAiRateLimit(admin, args.profile.organizationId, args.purpose, purpose);
  if (!limit.ok) {
    if ('countFailed' in limit) {
      log.error('AI の回数の上限を確かめられませんでした');
      return fail('unknown');
    }
    return fail('limit_exceeded', { retryAfterSeconds: limit.retryAfterSeconds });
  }

  const startedAt = Date.now();
  let outcome: { ok: true; value: T } | { ok: false; code: AiGenerateErrorCode };
  try {
    const raw = await getAiProvider(config.provider).generate({
      apiKey: config.apiKey,
      modelId,
      instructions: args.instructions,
      input: prepared.prepared,
      schema: args.schema,
      maxOutputTokens: purpose.maxOutputTokens,
      signal: args.signal,
    });
    const value = args.validate(raw);
    outcome = value === null ? { ok: false, code: 'bad_response' } : { ok: true, value };
  } catch (error) {
    // 提供元のエラーは分類だけを残す（本文・鍵は残さない）。
    outcome = { ok: false, code: error instanceof AiProviderError ? error.code : 'unknown' };
    if (!(error instanceof AiProviderError)) {
      log.error({ error }, 'AI の呼び出しで想定外のエラーが起きました');
    }
  }

  const recorded = await recordAiRequest(admin, {
    organizationId: args.profile.organizationId,
    userId: args.profile.id,
    purposeId: args.purpose,
    provider: config.provider,
    modelId,
    keySource: config.keySource,
    inputs: prepared.summary,
    result: outcome.ok ? 'success' : outcome.code,
    durationMs: Date.now() - startedAt,
  });
  if (!recorded) {
    log.error('AI の呼び出しの記録（監査ログ）に失敗しました');
  }

  if (!outcome.ok) {
    log.warn({ code: outcome.code, provider: config.provider, modelId }, 'AI の呼び出しに失敗しました');
    return fail(outcome.code);
  }
  return { ok: true, value: outcome.value, provider: config.provider, modelId };
};
