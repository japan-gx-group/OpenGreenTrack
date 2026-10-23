import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleProvider, toGoogleModelOptions } from '../google';
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
