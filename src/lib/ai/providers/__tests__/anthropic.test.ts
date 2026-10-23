import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_VERSION, anthropicProvider, toAnthropicModelOptions } from '../anthropic';
import { AiProviderError } from '../http';
import { installFetchMock, jsonResponse } from './fetchMock';

// テスト用のダミーの鍵。鍵らしい文字列をソースに書くと秘密情報の走査（gitleaks）に当たるため、同じ文字の繰り返しで作る。
const KEY = 'x'.repeat(24);

const supported = { supported: true };
const fullCapabilities = { pdf_input: supported, image_input: supported, structured_outputs: supported };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toAnthropicModelOptions', () => {
  it('能力がそろったものだけを残し、retired を除き、deprecated に印を付ける', () => {
    const options = toAnthropicModelOptions([
      { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-01T00:00:00Z', lifecycle: 'active', capabilities: fullCapabilities },
      { id: 'claude-old', display_name: 'Claude Old', created_at: '2025-01-01T00:00:00Z', lifecycle: 'deprecated', retires_at: '2026-12-31T00:00:00Z', capabilities: fullCapabilities },
      { id: 'claude-retired', display_name: 'Claude Retired', lifecycle: 'retired', capabilities: fullCapabilities },
      { id: 'claude-no-pdf', display_name: 'No PDF', lifecycle: 'active', capabilities: { ...fullCapabilities, pdf_input: { supported: false } } },
    ]);
    expect(options).toEqual([
      { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', createdAt: '2026-09-01T00:00:00Z', deprecated: false, retiresOn: null },
      { id: 'claude-old', displayName: 'Claude Old', createdAt: '2025-01-01T00:00:00Z', deprecated: true, retiresOn: '2026-12-31' },
    ]);
  });

  it('capabilities が返らないときは絞り込まない（判断できないものを勝手に隠さない）', () => {
    expect(toAnthropicModelOptions([{ id: 'claude-x', display_name: 'X' }])).toHaveLength(1);
  });

  it('ID の形が不正な行は除く', () => {
    expect(toAnthropicModelOptions([{ id: '../v1/messages' }, { id: 42 }, null])).toEqual([]);
  });
});

describe('anthropicProvider.listModels', () => {
  it('決まった URL に x-api-key と anthropic-version を付けて呼び、ページを最後まで辿る', async () => {
    const { requests } = installFetchMock([
      jsonResponse(200, { data: [{ id: 'claude-a', display_name: 'A', created_at: '2026-01-01T00:00:00Z' }], has_more: true, last_id: 'claude-a' }),
      jsonResponse(200, { data: [{ id: 'claude-b', display_name: 'B', created_at: '2026-06-01T00:00:00Z' }], has_more: false, last_id: 'claude-b' }),
    ]);

    const models = await anthropicProvider.listModels(KEY);

    expect(requests.map((r) => r.url)).toEqual([
      'https://api.anthropic.com/v1/models?limit=1000',
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-a',
    ]);
    expect(requests[0].headers['x-api-key']).toBe(KEY);
    expect(requests[0].headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(requests[0].init.redirect).toBe('error');
    // 新しい順
    expect(models.map((m) => m.id)).toEqual(['claude-b', 'claude-a']);
  });

  it('HTTP のエラーを分類に変え、メッセージに鍵も本文も含めない', async () => {
    installFetchMock([jsonResponse(401, { error: { message: `invalid x-api-key ${KEY}` } })]);
    const error = await anthropicProvider.listModels(KEY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).code).toBe('invalid_key');
    expect((error as AiProviderError).message).not.toContain(KEY);
  });

  it('529 は混雑として扱う', async () => {
    installFetchMock([jsonResponse(529, {})]);
    await expect(anthropicProvider.listModels(KEY)).rejects.toMatchObject({ code: 'overloaded' });
  });

  it('応答の形が違えば bad_response', async () => {
    installFetchMock([jsonResponse(200, { models: [] })]);
    await expect(anthropicProvider.listModels(KEY)).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('通信が打ち切られたら timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'TimeoutError';
    installFetchMock([abort]);
    await expect(anthropicProvider.listModels(KEY)).rejects.toMatchObject({ code: 'timeout' });
  });
});
