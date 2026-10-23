// OpenAI（ChatGPT のモデル）のモデル一覧（サーバ専用）。
//
// GET https://api.openai.com/v1/models
// - 鍵は Authorization: Bearer で送る。ページは無い。
// - 一覧には埋め込み・音声・画像生成・モデレーションなども含まれ、能力の項目も表示名も無い。
//   そこで ID で判定する（名前による推定）: gpt-4o・gpt-4.1・gpt-5 以降・o3 以降で始まるものを残し、
//   embedding・tts・transcribe・whisper・audio・realtime・image・dall-e・moderation・search・instruct を含むもの、
//   ファインチューニング（ft: で始まる。ID の形の検証でも落ちる）を除く。
// - shutdown_date があれば「廃止予定」として末尾に並べる。

import 'server-only';
import { isValidAiModelId, type AiModelOption } from '@/types/ai';
import {
  AiProviderError,
  LIST_MODELS_TIMEOUT_MS,
  classifyHttpStatus,
  fetchProviderJson,
  isRecord,
  toDateOnly,
  withTimeout,
  type ClassifyHttpError,
} from './http';
import { sortModelOptions } from './sortModels';
import type { AiProvider } from './types';

const API_BASE = 'https://api.openai.com/v1';
const INCLUDED_FAMILIES = /^(gpt-(4o|4\.1|([5-9]|[1-9]\d)(\.\d+)?)|o([3-9]|[1-9]\d))(-|$)/;
const EXCLUDED_KINDS = /(embedding|tts|transcribe|whisper|audio|realtime|image|dall-e|moderation|search|instruct)/;

const errorCodeOf = (body: unknown): unknown =>
  isRecord(body) && isRecord(body.error) ? body.error.code : undefined;

// 429 のうち insufficient_quota は利用枠・支払いの問題（時間をおいても解けない）。
// 403 は「対応していない国・地域からの利用」を表すので、鍵の誤りとは分ける。
const classify: ClassifyHttpError = (status, body) => {
  if (status === 429 && errorCodeOf(body) === 'insufficient_quota') return 'billing';
  if (status === 403) return 'unknown';
  return classifyHttpStatus(status);
};

/** UNIX 秒・ISO 8601 のどちらで返っても YYYY-MM-DD にする */
const toRetiresOn = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }
  return toDateOnly(value);
};

/** 一覧の行を、プルダウンの形に絞って揃える（テストのため export する） */
export const toOpenAiModelOptions = (rows: unknown[]): AiModelOption[] =>
  rows.flatMap((row) => {
    if (!isRecord(row) || !isValidAiModelId(row.id)) return [];
    if (!INCLUDED_FAMILIES.test(row.id) || EXCLUDED_KINDS.test(row.id)) return [];
    const retiresOn = toRetiresOn(row.shutdown_date);
    return [
      {
        id: row.id,
        displayName: row.id,
        createdAt:
          typeof row.created === 'number' && Number.isFinite(row.created)
            ? new Date(row.created * 1000).toISOString()
            : null,
        deprecated: retiresOn !== null,
        retiresOn,
      },
    ];
  });

export const openAiProvider: AiProvider = {
  id: 'openai',
  async listModels(apiKey, signal) {
    const body = await fetchProviderJson(
      `${API_BASE}/models`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: withTimeout(LIST_MODELS_TIMEOUT_MS, signal),
      },
      classify,
    );
    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new AiProviderError('bad_response');
    }
    return sortModelOptions(toOpenAiModelOptions(body.data));
  },
};
