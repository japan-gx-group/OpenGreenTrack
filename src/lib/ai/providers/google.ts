// Google（Gemini API）のモデル一覧（サーバ専用）。Vertex AI ではなく generativelanguage.googleapis.com を使う。
//
// GET https://generativelanguage.googleapis.com/v1beta/models
// - 鍵は x-goog-api-key ヘッダで送る。URL のクエリ（?key=）には載せない（URL がログに出ても鍵は出ないように）。
// - ページは nextPageToken で最後まで辿る（MAX_LIST_PAGES まで）。
// - 一覧には埋め込み・画像や動画の生成なども含まれ、PDF・画像を読めるかを示す項目が無い。
//   そこで、呼び出し方（supportedGenerationMethods）に generateContent を含み、名前が models/gemini- で始まり、
//   生成専用の種類（embedding・imagen・veo・tts・image・live・audio・lyria）を含まないものを残す（名前による推定）。
// - 作成日も廃止の予定も返らないので、ID の降順に並べる。

import 'server-only';
import { isValidAiModelId, type AiModelOption } from '@/types/ai';
import type { AiPreparedInput } from '../inputCheck';
import {
  AiProviderError,
  GENERATE_TIMEOUT_MS,
  LIST_MODELS_TIMEOUT_MS,
  MAX_LIST_PAGES,
  classifyHttpStatus,
  fetchProviderJson,
  isRecord,
  parseJsonOutput,
  postJson,
  withTimeout,
  type ClassifyHttpError,
} from './http';
import { sortModelOptions } from './sortModels';
import type { AiGenerateRequest, AiProvider } from './types';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_NAME_PREFIX = 'models/';
const EXCLUDED_KINDS = /(embedding|imagen|veo|tts|image|live|audio|lyria)/i;

// 鍵が無効なとき、Gemini は 400（reason: API_KEY_INVALID）を返すことがある。それ以外の 400 は入力の誤り。
const isInvalidKeyBody = (body: unknown): boolean => {
  if (!isRecord(body) || !isRecord(body.error)) return false;
  const details = Array.isArray(body.error.details) ? body.error.details : [];
  return (
    body.error.status === 'UNAUTHENTICATED' ||
    details.some((detail) => isRecord(detail) && detail.reason === 'API_KEY_INVALID')
  );
};

const classify: ClassifyHttpError = (status, body) =>
  status === 400 && isInvalidKeyBody(body) ? 'invalid_key' : classifyHttpStatus(status);

/** 一覧の 1 ページ分の行を、プルダウンの形に絞って揃える（テストのため export する） */
export const toGoogleModelOptions = (rows: unknown[]): AiModelOption[] =>
  rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.name !== 'string') return [];
    if (!row.name.startsWith(`${MODEL_NAME_PREFIX}gemini-`)) return [];
    const methods = Array.isArray(row.supportedGenerationMethods) ? row.supportedGenerationMethods : [];
    if (!methods.includes('generateContent')) return [];
    const id = row.name.slice(MODEL_NAME_PREFIX.length);
    if (EXCLUDED_KINDS.test(id) || !isValidAiModelId(id)) return [];
    const displayName = typeof row.displayName === 'string' && row.displayName ? row.displayName : id;
    return [{ id, displayName, createdAt: null, deprecated: false, retiresOn: null }];
  });

const toPart = (part: AiPreparedInput) =>
  part.type === 'text' ? { text: part.text } : { inlineData: { mimeType: part.mimeType, data: part.base64 } };

/** generateContent に送る本文（テストのため export する） */
export const buildGoogleGenerateBody = (request: AiGenerateRequest) => ({
  systemInstruction: { parts: [{ text: request.instructions }] },
  contents: [{ role: 'user', parts: request.input.map(toPart) }],
  // 決まった形（JSON スキーマ）で出力させる。responseMimeType と responseJsonSchema の組み合わせを使う
  // （新しい responseFormat が正式版かを確かめられていないため、以前から使える書き方にする）。
  generationConfig: {
    responseMimeType: 'application/json',
    responseJsonSchema: request.schema,
    maxOutputTokens: request.maxOutputTokens,
  },
});

/** generateContent の応答から JSON を取り出す（テストのため export する） */
export const readGoogleOutput = (body: unknown): unknown => {
  if (!isRecord(body)) throw new AiProviderError('bad_response');
  // 入力が安全上の理由で止められたとき（promptFeedback.blockReason）は候補が返らない。
  if (isRecord(body.promptFeedback) && body.promptFeedback.blockReason) {
    throw new AiProviderError('bad_response');
  }
  const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  if (!isRecord(candidate)) throw new AiProviderError('bad_response');
  // STOP 以外（MAX_TOKENS・SAFETY など）は、形が欠けている可能性があるため使わない。
  if (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP') {
    throw new AiProviderError('bad_response');
  }
  const parts = isRecord(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('');
  return parseJsonOutput(text);
};

export const googleProvider: AiProvider = {
  id: 'google',
  async generate(request) {
    // モデル ID は保存前に形を確かめているが、URL のパスに入るので送る直前にも確かめ、エンコードする。
    if (!isValidAiModelId(request.modelId)) throw new AiProviderError('model_unavailable');
    const body = await postJson(
      `${API_BASE}/models/${encodeURIComponent(request.modelId)}:generateContent`,
      { 'x-goog-api-key': request.apiKey },
      buildGoogleGenerateBody(request),
      withTimeout(GENERATE_TIMEOUT_MS, request.signal),
      classify,
    );
    return readGoogleOutput(body);
  },
  async listModels(apiKey, signal) {
    const requestSignal = withTimeout(LIST_MODELS_TIMEOUT_MS, signal);
    const models: AiModelOption[] = [];
    let pageToken: string | null = null;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const query = new URLSearchParams({ pageSize: '1000' });
      if (pageToken) query.set('pageToken', pageToken);
      const body = await fetchProviderJson(
        `${API_BASE}/models?${query.toString()}`,
        { method: 'GET', headers: { 'x-goog-api-key': apiKey }, signal: requestSignal },
        classify,
      );
      if (!isRecord(body) || (body.models !== undefined && !Array.isArray(body.models))) {
        throw new AiProviderError('bad_response');
      }
      models.push(...toGoogleModelOptions(Array.isArray(body.models) ? body.models : []));
      if (typeof body.nextPageToken !== 'string' || !body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }

    return sortModelOptions(models);
  },
};
