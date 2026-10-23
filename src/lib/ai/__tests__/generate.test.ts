import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiPurpose } from '../purposes';
import { PDF_BYTES, PNG_BYTES } from './testFiles';

// 共通の入口（generateStructured）の処理の順番と、各段階で断る理由を確かめる。
// 用途の一覧・提供元・DB（ai_settings）・回数の上限・監査ログはモックし、入力の確認とスキーマの確認は実物を通す。

const TEST_PURPOSE: AiPurpose = {
  label: 'テストの用途',
  inputs: ['text', 'pdf'],
  maxInputBytes: 1024,
  limits: { perMinute: 5, perDay: 100 },
  maxOutputTokens: 800,
};

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  settings: null as null | { provider: string; modelId: string },
  rateLimit: vi.fn(),
  recordAiRequest: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../purposes', async (importOriginal) => {
  const original = await importOriginal<typeof import('../purposes')>();
  return { ...original, findAiPurpose: (id: string) => (id === 'test_purpose' ? TEST_PURPOSE : undefined) };
});
vi.mock('../providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../providers')>();
  return { ...original, getAiProvider: () => ({ id: 'anthropic', listModels: vi.fn(), generate: mocks.generate }) };
});
vi.mock('../rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rateLimit')>()),
  checkAiRateLimit: mocks.rateLimit,
}));
vi.mock('../auditLog', () => ({ recordAiRequest: mocks.recordAiRequest }));
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => {
    const log = { error: mocks.logError, warn: vi.fn(), child: () => log };
    return log;
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.settings, error: null }) }) }),
    }),
  }),
}));

import { AiProviderError } from '../providers';
import { generateStructured, type GenerateStructuredArgs } from '../generate';

// テスト用のダミーの鍵。鍵らしい文字列をソースに書くと秘密情報の走査（gitleaks）に当たるため、同じ文字の繰り返しで作る。
const KEY = 'x'.repeat(24);

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['amount'],
  properties: { amount: { type: ['number', 'null'] } },
};

const validate = (value: unknown) =>
  typeof value === 'object' && value !== null && typeof (value as { amount?: unknown }).amount === 'number'
    ? (value as { amount: number })
    : null;

const args = (overrides: Partial<GenerateStructuredArgs<{ amount: number }>> = {}) =>
  ({
    purpose: 'test_purpose',
    profile: { id: 'user-1', organizationId: 'org-1' },
    instructions: '請求書から使用量を読み取る',
    input: [{ type: 'pdf', data: PDF_BYTES }],
    schema,
    validate,
    ...overrides,
  }) as unknown as GenerateStructuredArgs<{ amount: number }>;

describe('generateStructured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('AI_API_KEY', KEY);
    vi.stubEnv('AI_ALLOW_KEY_REGISTRATION', '');
    mocks.settings = { provider: 'anthropic', modelId: 'claude-sonnet-5-5' };
    mocks.rateLimit.mockResolvedValue({ ok: true });
    mocks.recordAiRequest.mockResolvedValue(true);
    mocks.generate.mockResolvedValue({ amount: 1234 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('選んだモデルで送り、検証した値を返し、監査ログに残す', async () => {
    const result = await generateStructured(args());
    expect(result).toEqual({ ok: true, value: { amount: 1234 }, provider: 'anthropic', modelId: 'claude-sonnet-5-5' });

    const request = mocks.generate.mock.calls[0][0];
    expect(request).toMatchObject({
      apiKey: KEY,
      modelId: 'claude-sonnet-5-5',
      instructions: '請求書から使用量を読み取る',
      maxOutputTokens: 800,
      input: [{ type: 'file', mimeType: 'application/pdf' }],
    });

    const record = mocks.recordAiRequest.mock.calls[0][1];
    expect(record).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-1',
      purposeId: 'test_purpose',
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      keySource: 'server',
      result: 'success',
      inputs: [{ type: 'pdf', bytes: PDF_BYTES.byteLength }],
    });
    // 監査ログに鍵・送った内容・出力を含めない
    const recorded = JSON.stringify(record);
    expect(recorded).not.toContain(KEY);
    expect(recorded).not.toContain(Buffer.from(PDF_BYTES).toString('base64'));
    expect(recorded).not.toContain('1234');
  });

  it('登録していない用途からは呼べず、提供元にも送らない', async () => {
    const result = await generateStructured(args({ purpose: 'not_registered' as never }));
    expect(result).toMatchObject({ ok: false, code: 'unknown_purpose' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('3 社で使えない出力の形は、送る前に断る', async () => {
    const result = await generateStructured(args({ schema: { type: 'object', properties: { amount: { type: 'number' } } } }));
    expect(result).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(mocks.logError).toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('用途の範囲外の入力（許していない種類）は送る前に断る', async () => {
    const result = await generateStructured(args({ input: [{ type: 'image', data: PNG_BYTES }] }));
    expect(result).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('環境変数が無ければ not_configured、モデルを選んでいなければ model_not_selected', async () => {
    vi.stubEnv('AI_API_KEY', '');
    await expect(generateStructured(args())).resolves.toMatchObject({ ok: false, code: 'not_configured' });

    vi.stubEnv('AI_API_KEY', KEY);
    mocks.settings = null;
    await expect(generateStructured(args())).resolves.toMatchObject({ ok: false, code: 'model_not_selected' });

    // 選んだ時点の提供元が今の提供元と違う
    mocks.settings = { provider: 'openai', modelId: 'gpt-5' };
    await expect(generateStructured(args())).resolves.toMatchObject({ ok: false, code: 'model_not_selected' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('回数の上限を超えたら、送らずに待つ時間を返す', async () => {
    mocks.rateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    const result = await generateStructured(args());
    expect(result).toMatchObject({ ok: false, code: 'limit_exceeded', retryAfterSeconds: 60 });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.recordAiRequest).not.toHaveBeenCalled();
  });

  it('機能側の検証で不合格なら bad_response にし、失敗として記録する', async () => {
    mocks.generate.mockResolvedValue({ amount: '多い' });
    const result = await generateStructured(args());
    expect(result).toMatchObject({ ok: false, code: 'bad_response' });
    expect(mocks.recordAiRequest.mock.calls[0][1]).toMatchObject({ result: 'bad_response' });
  });

  it('提供元の失敗は分類をそのまま返し、失敗として記録する', async () => {
    mocks.generate.mockRejectedValue(new AiProviderError('rate_limited', 429));
    const result = await generateStructured(args());
    expect(result).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(mocks.recordAiRequest.mock.calls[0][1]).toMatchObject({ result: 'rate_limited' });
  });

  it('監査ログに失敗しても、結果は変えずにログに残す', async () => {
    mocks.recordAiRequest.mockResolvedValue(false);
    const result = await generateStructured(args());
    expect(result.ok).toBe(true);
    expect(mocks.logError).toHaveBeenCalled();
  });
});
