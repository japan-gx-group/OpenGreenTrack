import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpenAiResponsesBody, openAiProvider, readOpenAiOutput, toOpenAiModelOptions } from '../openai';
import { AiProviderError } from '../http';
import { installFetchMock, jsonResponse } from './fetchMock';

// テスト用のダミーの鍵。鍵らしい文字列をソースに書くと秘密情報の走査（gitleaks）に当たるため、同じ文字の繰り返しで作る。
const KEY = 'x'.repeat(24);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toOpenAiModelOptions', () => {
  it('ID の規則で、画像・PDF を読める対話用のモデルだけを残す', () => {
    const ids = [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4.1-nano',
      'gpt-5',
      'gpt-5.1',
      'o3',
      'o4-mini',
      // 除くもの
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4o-audio-preview',
      'gpt-4o-realtime-preview',
      'gpt-4o-mini-tts',
      'gpt-4o-transcribe',
      'gpt-4o-search-preview',
      'gpt-image-1',
      'text-embedding-3-large',
      'omni-moderation-latest',
      'dall-e-3',
      'whisper-1',
      'gpt-3.5-turbo-instruct',
      'o1',
      'ft:gpt-4o:org:custom:abc',
    ];
    const options = toOpenAiModelOptions(ids.map((id) => ({ id, object: 'model', created: 1_700_000_000 })));
    expect(options.map((o) => o.id)).toEqual(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-5', 'gpt-5.1', 'o3', 'o4-mini']);
    expect(options[0]).toMatchObject({ displayName: 'gpt-4o', createdAt: '2023-11-14T22:13:20.000Z' });
  });

  it('shutdown_date があれば廃止予定にする（UNIX 秒・日付の文字列のどちらでも）', () => {
    const [bySeconds, byString] = toOpenAiModelOptions([
      { id: 'gpt-4o-2024-05-13', created: 1, shutdown_date: 1_798_761_600 },
      { id: 'gpt-4o-2024-08-06', created: 2, shutdown_date: '2027-01-15' },
    ]);
    expect(bySeconds).toMatchObject({ deprecated: true, retiresOn: '2027-01-01' });
    expect(byString).toMatchObject({ deprecated: true, retiresOn: '2027-01-15' });
  });
});

describe('openAiProvider.listModels', () => {
  it('Authorization: Bearer で決まった URL を呼び、新しい順に並べる', async () => {
    const { requests } = installFetchMock([
      jsonResponse(200, {
        object: 'list',
        data: [
          { id: 'gpt-4o', created: 100 },
          { id: 'gpt-5', created: 300 },
          { id: 'gpt-4.1', created: 200 },
        ],
      }),
    ]);
    const models = await openAiProvider.listModels(KEY);
    expect(requests[0].url).toBe('https://api.openai.com/v1/models');
    expect(requests[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(models.map((m) => m.id)).toEqual(['gpt-5', 'gpt-4.1', 'gpt-4o']);
  });

  it('429 の insufficient_quota は billing、ほかの 429 は rate_limited、403 は unknown', async () => {
    installFetchMock([jsonResponse(429, { error: { code: 'insufficient_quota' } })]);
    await expect(openAiProvider.listModels(KEY)).rejects.toMatchObject({ code: 'billing' });
    installFetchMock([jsonResponse(429, { error: { code: 'rate_limit_exceeded' } })]);
    await expect(openAiProvider.listModels(KEY)).rejects.toMatchObject({ code: 'rate_limited' });
    installFetchMock([jsonResponse(403, { error: { code: 'unsupported_country_region_territory' } })]);
    await expect(openAiProvider.listModels(KEY)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('鍵の誤りのメッセージに鍵の一部が含まれていても、例外のメッセージには出さない', async () => {
    installFetchMock([jsonResponse(401, { error: { message: `Incorrect API key provided: ${KEY.slice(0, 8)}***` } })]);
    const error = await openAiProvider.listModels(KEY).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_key' });
    expect(String((error as Error).message)).not.toContain(KEY.slice(0, 8));
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
  modelId: 'gpt-5',
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

describe('openAiProvider.generate', () => {
  it('Responses API に store: false で送り、PDF は input_file・画像は input_image、出力の形は strict の json_schema', async () => {
    const { requests } = installFetchMock([
      jsonResponse(200, {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"amount": 9}' }] }],
      }),
    ]);
    const output = await openAiProvider.generate(request());
    expect(output).toEqual({ amount: 9 });

    expect(requests[0].url).toBe('https://api.openai.com/v1/responses');
    expect(requests[0].headers.authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(requests[0].init.body));
    expect(body).toEqual(buildOpenAiResponsesBody(request()));
    expect(body).toMatchObject({
      model: 'gpt-5',
      instructions: '使用量を読み取る',
      store: false,
      max_output_tokens: 800,
      text: { format: { type: 'json_schema', name: 'result', schema: SCHEMA, strict: true } },
    });
    expect(body.input[0].content).toEqual([
      { type: 'input_file', filename: 'input.pdf', file_data: 'data:application/pdf;base64,UERGLWJhc2U2NA==' },
      { type: 'input_image', image_url: 'data:image/png;base64,UE5HLWJhc2U2NA==' },
      { type: 'input_text', text: '補足の文' },
    ]);
    expect(body).not.toHaveProperty('tools');
  });

  it('拒否・打ち切り（incomplete）・JSON でない応答は bad_response', () => {
    expect(() =>
      readOpenAiOutput({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'できません' }] }] }),
    ).toThrow(AiProviderError);
    expect(() =>
      readOpenAiOutput({ status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"amount":' }] }] }),
    ).toThrow(AiProviderError);
    expect(() => readOpenAiOutput({ status: 'completed', output: [] })).toThrow(AiProviderError);
  });
});
