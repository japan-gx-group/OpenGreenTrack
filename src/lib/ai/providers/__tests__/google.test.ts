import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGoogleGenerateBody, googleProvider, readGoogleOutput, toGoogleModelOptions } from '../google';
import { AiProviderError } from '../http';
import { installFetchMock, jsonResponse } from './fetchMock';

// テスト用のダミーの鍵。鍵らしい文字列をソースに書くと秘密情報の走査（gitleaks）に当たるため、同じ文字の繰り返しで作る。
const KEY = 'x'.repeat(24);

const model = (name: string, methods = ['generateContent', 'countTokens'], displayName = name) => ({
  name,
  displayName,
  supportedGenerationMethods: methods,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toGoogleModelOptions', () => {
  it('generateContent を持つ gemini のモデルだけを残し、生成専用の種類を除き、models/ を外す', () => {
    const options = toGoogleModelOptions([
      model('models/gemini-2.5-flash', undefined, 'Gemini 2.5 Flash'),
      model('models/gemini-embedding-001', ['embedContent']),
      model('models/gemini-2.5-flash-image', undefined),
      model('models/gemini-2.5-flash-preview-tts', undefined),
      model('models/imagen-4.0-generate-001', ['predict']),
      model('models/gemma-3-27b-it', undefined),
      model('models/gemini-live-2.5-flash', ['bidiGenerateContent']),
    ]);
    expect(options).toEqual([
      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', createdAt: null, deprecated: false, retiresOn: null },
    ]);
  });
});

describe('googleProvider.listModels', () => {
  it('鍵は x-goog-api-key ヘッダで送り、URL には載せない。ページを最後まで辿る', async () => {
    const { requests } = installFetchMock([
      jsonResponse(200, { models: [model('models/gemini-2.0-flash')], nextPageToken: 'next-1' }),
      jsonResponse(200, { models: [model('models/gemini-2.5-pro')] }),
    ]);

    const models = await googleProvider.listModels(KEY);

    expect(requests.map((r) => r.url)).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=next-1',
    ]);
    expect(requests.every((r) => !r.url.includes(KEY))).toBe(true);
    expect(requests[0].headers['x-goog-api-key']).toBe(KEY);
    // 作成日が無いので ID の降順
    expect(models.map((m) => m.id)).toEqual(['gemini-2.5-pro', 'gemini-2.0-flash']);
  });

  it('400 で鍵の誤りを示すものは invalid_key、それ以外の 400 は input_rejected', async () => {
    installFetchMock([
      jsonResponse(400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }),
    ]);
    await expect(googleProvider.listModels(KEY)).rejects.toMatchObject({ code: 'invalid_key' });

    installFetchMock([jsonResponse(400, { error: { status: 'INVALID_ARGUMENT' } })]);
    await expect(googleProvider.listModels(KEY)).rejects.toMatchObject({ code: 'input_rejected' });
  });

  it('403 は invalid_key、429 は rate_limited', async () => {
    installFetchMock([jsonResponse(403, {})]);
    await expect(googleProvider.listModels(KEY)).rejects.toMatchObject({ code: 'invalid_key' });
    installFetchMock([jsonResponse(429, {})]);
    await expect(googleProvider.listModels(KEY)).rejects.toMatchObject({ code: 'rate_limited' });
  });
});

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['amount'],
  properties: { amount: { type: ['number', 'null'] } },
};

const request = (overrides = {}) => ({
  apiKey: KEY,
  modelId: 'gemini-2.5-flash',
  instructions: '使用量を読み取る',
  input: [
    { type: 'file' as const, mimeType: 'application/pdf' as const, base64: 'UERGLWJhc2U2NA==' },
    { type: 'file' as const, mimeType: 'image/png' as const, base64: 'UE5HLWJhc2U2NA==' },
    { type: 'text' as const, text: '補足の文' },
  ],
  schema: SCHEMA,
  maxOutputTokens: 800,
  ...overrides,
});

describe('googleProvider.generate', () => {
  it('generateContent に inlineData で送り、出力の形を responseJsonSchema で指定する。鍵は URL に載せない', async () => {
    const { requests } = installFetchMock([
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: '{"amount": 7}' }] }, finishReason: 'STOP' }] }),
    ]);
    const output = await googleProvider.generate(request());
    expect(output).toEqual({ amount: 7 });

    expect(requests[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(requests[0].url).not.toContain(KEY);
    expect(requests[0].headers['x-goog-api-key']).toBe(KEY);
    const body = JSON.parse(String(requests[0].init.body));
    expect(body).toEqual(buildGoogleGenerateBody(request()));
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: '使用量を読み取る' }] },
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA, maxOutputTokens: 800 },
    });
    expect(body.contents[0].parts).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: 'UERGLWJhc2U2NA==' } },
      { inlineData: { mimeType: 'image/png', data: 'UE5HLWJhc2U2NA==' } },
      { text: '補足の文' },
    ]);
  });

  it('URL のパスに入るモデル ID の形が不正なら、送らずに断る', async () => {
    const { fetchMock } = installFetchMock([]);
    await expect(googleProvider.generate(request({ modelId: '../files' }))).rejects.toMatchObject({ code: 'model_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('止められた入力・STOP 以外の終わり方・候補が無い応答は bad_response', () => {
    expect(() => readGoogleOutput({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(AiProviderError);
    expect(() => readGoogleOutput({ candidates: [{ content: { parts: [{ text: '{"amount":' }] }, finishReason: 'MAX_TOKENS' }] })).toThrow(AiProviderError);
    expect(() => readGoogleOutput({ candidates: [] })).toThrow(AiProviderError);
  });

  it('分かれて返った文を つなげて読む', () => {
    expect(readGoogleOutput({ candidates: [{ content: { parts: [{ text: '{"amou' }, { text: 'nt": 5}' }] }, finishReason: 'STOP' }] })).toEqual({ amount: 5 });
  });
});
