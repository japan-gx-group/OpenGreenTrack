import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  profile: null as null | { id: string; organizationId: string; role: string },
  settings: null as null | { provider: string; modelId: string },
}));

vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: async () => mocks.profile }));
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => ({ warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: mocks.settings, error: null }) }) }),
  }),
}));

import { GET } from '../route';

// テスト用のダミーの鍵。鍵らしい文字列をソースに書くと秘密情報の走査（gitleaks）に当たるため、同じ文字の繰り返しで作る。
const KEY = 'x'.repeat(24);

describe('GET /api/ai/status', () => {
  beforeEach(() => {
    mocks.profile = { id: 'member-1', organizationId: 'org-1', role: 'logger' };
    mocks.settings = { provider: 'anthropic', modelId: 'claude-sonnet-5-5' };
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('AI_API_KEY', KEY);
    vi.stubEnv('AI_ALLOW_KEY_REGISTRATION', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ログインしていなければ 401', async () => {
    mocks.profile = null;
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('メンバーにも状態を返す。鍵の値は返さない', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toEqual({
      keySource: 'server',
      configured: true,
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      canManage: false,
    });
  });

  it('管理者なら canManage が true', async () => {
    mocks.profile = { id: 'admin-1', organizationId: 'org-1', role: 'admin' };
    await expect((await GET()).json()).resolves.toMatchObject({ canManage: true });
  });

  it('選んだ時点の提供元と今の提供元が違えば、モデルは未選択として返す', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    await expect((await GET()).json()).resolves.toMatchObject({ provider: 'openai', modelId: null });
  });

  it('環境変数が無ければ未設定として返す', async () => {
    vi.stubEnv('AI_API_KEY', '');
    await expect((await GET()).json()).resolves.toMatchObject({
      configured: false,
      provider: null,
      modelId: null,
    });
  });
});
