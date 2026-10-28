import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
}));

vi.mock('../providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../providers')>();
  return {
    ...original,
    getAiProvider: () => ({ id: 'openai', listModels: mocks.listModels }),
  };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { AiProviderError } from '../providers';
import { MODEL_LIST_LIMIT_PER_MINUTE, listAvailableModels, resetModelListLimiterForTest } from '../models';

// テスト用のダミーの鍵。鍵らしい文字列をソースに書くと秘密情報の走査（gitleaks）に当たるため、同じ文字の繰り返しで作る。
const KEY = 'x'.repeat(24);

describe('listAvailableModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModelListLimiterForTest();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', KEY);
    vi.stubEnv('AI_ALLOW_KEY_REGISTRATION', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('環境変数の鍵で提供元の一覧を取る', async () => {
    mocks.listModels.mockResolvedValue([{ id: 'gpt-5', displayName: 'gpt-5', createdAt: null, deprecated: false, retiresOn: null }]);
    const result = await listAvailableModels('org-1');
    expect(result).toMatchObject({ ok: true, provider: 'openai', models: [{ id: 'gpt-5' }] });
    expect(mocks.listModels).toHaveBeenCalledWith(KEY, undefined);
  });

  it('環境変数が無ければ 503 で、提供元を呼ばない', async () => {
    vi.stubEnv('AI_API_KEY', '');
    const result = await listAvailableModels('org-1');
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'not_configured' });
    expect(mocks.listModels).not.toHaveBeenCalled();
  });

  it('提供元のエラーは分類ごとの決まった文にし、502 を返す（鍵は含めない）', async () => {
    mocks.listModels.mockRejectedValue(new AiProviderError('invalid_key', 401));
    const result = await listAvailableModels('org-1');
    expect(result).toMatchObject({ ok: false, status: 502, reason: 'invalid_key' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('組織ごとに 1 分の回数の上限を超えたら 429 で、提供元を呼ばない', async () => {
    mocks.listModels.mockResolvedValue([]);
    for (let i = 0; i < MODEL_LIST_LIMIT_PER_MINUTE; i += 1) {
      await listAvailableModels('org-1');
    }
    mocks.listModels.mockClear();
    const result = await listAvailableModels('org-1');
    expect(result).toMatchObject({ ok: false, status: 429, reason: 'local_rate_limited' });
    expect(mocks.listModels).not.toHaveBeenCalled();
    // 別の組織は数えない
    await expect(listAvailableModels('org-2')).resolves.toMatchObject({ ok: true });
  });
});
