// Anthropic（Claude）のモデル一覧（サーバ専用）。
//
// GET https://api.anthropic.com/v1/models
// - 鍵は x-api-key ヘッダで送る。anthropic-version は互換性の高い 2023-06-01 に固定する
//   （新しい版はサンプリングのパラメータの扱いなどが変わるため、生成を作るときに改めて決める）。
// - ページは has_more / last_id で最後まで辿る（MAX_LIST_PAGES まで）。
// - 一覧は対話用のモデルだけを返す。capabilities（pdf_input・image_input・structured_outputs）が返る場合は
//   すべて対応しているものだけを残し、返らない場合は絞り込まない（判断できないものを勝手に隠さない）。
//   lifecycle が retired のものは除き、deprecated は「廃止予定」として末尾に並べる。

import 'server-only';
import { isValidAiModelId, type AiModelOption } from '@/types/ai';
import {
  AiProviderError,
  LIST_MODELS_TIMEOUT_MS,
  MAX_LIST_PAGES,
  classifyHttpStatus,
  fetchProviderJson,
  isRecord,
  toDateOnly,
  withTimeout,
  type ClassifyHttpError,
} from './http';
import { sortModelOptions } from './sortModels';
import type { AiProvider } from './types';

const API_BASE = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';

// 529 は Anthropic の「混雑」。
const classify: ClassifyHttpError = (status) => (status === 529 ? 'overloaded' : classifyHttpStatus(status));

const REQUIRED_CAPABILITIES = ['pdf_input', 'image_input', 'structured_outputs'] as const;

const supportsRequiredCapabilities = (capabilities: unknown): boolean => {
  if (!isRecord(capabilities)) return true;
  return REQUIRED_CAPABILITIES.every((name) => {
    const capability = capabilities[name];
    return isRecord(capability) && capability.supported === true;
  });
};

/** 一覧の 1 ページ分の行を、プルダウンの形に絞って揃える（テストのため export する） */
export const toAnthropicModelOptions = (rows: unknown[]): AiModelOption[] =>
  rows.flatMap((row) => {
    if (!isRecord(row) || !isValidAiModelId(row.id)) return [];
    if (row.lifecycle === 'retired') return [];
    if (!supportsRequiredCapabilities(row.capabilities)) return [];
    const displayName = typeof row.display_name === 'string' && row.display_name ? row.display_name : row.id;
    return [
      {
        id: row.id,
        displayName,
        createdAt: typeof row.created_at === 'string' ? row.created_at : null,
        deprecated: row.lifecycle === 'deprecated',
        retiresOn: toDateOnly(row.retires_at),
      },
    ];
  });

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  async listModels(apiKey, signal) {
    const requestSignal = withTimeout(LIST_MODELS_TIMEOUT_MS, signal);
    const models: AiModelOption[] = [];
    let afterId: string | null = null;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: '1000' });
      if (afterId) query.set('after_id', afterId);
      const body = await fetchProviderJson(
        `${API_BASE}/models?${query.toString()}`,
        {
          method: 'GET',
          headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
          signal: requestSignal,
        },
        classify,
      );
      if (!isRecord(body) || !Array.isArray(body.data)) {
        throw new AiProviderError('bad_response');
      }
      models.push(...toAnthropicModelOptions(body.data));
      if (body.has_more !== true || typeof body.last_id !== 'string') break;
      afterId = body.last_id;
    }

    return sortModelOptions(models);
  },
};
