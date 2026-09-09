import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// CSRF 緩和（Origin とサイト自身のホストの比較）だけを検証する。
// 同一オリジンと判定された後の処理は Cookie セッションと admin client に依存するため、
// getUser を「未ログイン」にして 401 で止め、Origin 判定を通過したことの目印にする。
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
}));

import { POST } from '../route';

const postRequest = (headers: Record<string, string>) =>
  new NextRequest('http://internal.local/api/account/delete', { method: 'POST', headers });

describe('POST /api/account/delete の Origin 検証', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('Origin が Host と一致すれば通す（プロキシ無しの素の構成）', async () => {
    const response = await POST(
      postRequest({ origin: 'https://ghg.example.com', host: 'ghg.example.com' }),
    );
    expect(response.status).toBe(401);
  });

  it('Origin が無ければ 403（クロスサイトの form POST 等）', async () => {
    const response = await POST(postRequest({ host: 'ghg.example.com' }));
    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('Origin が別サイトなら 403', async () => {
    const response = await POST(
      postRequest({ origin: 'https://evil.example.com', host: 'ghg.example.com' }),
    );
    expect(response.status).toBe(403);
  });

  // nginx 等で proxy_set_header Host が無いと Host は内部値（localhost:3000）になる。
  // その場合でも x-forwarded-host に公開ホストが載っていれば正規のリクエストとして通す。
  it('リバースプロキシ越し: Host が内部値でも x-forwarded-host と一致すれば通す', async () => {
    const response = await POST(
      postRequest({
        origin: 'https://ghg.example.com',
        host: 'localhost:3000',
        'x-forwarded-host': 'ghg.example.com',
      }),
    );
    expect(response.status).toBe(401);
  });

  it('APP_URL が設定されていればそのホストと比較する（Host 系ヘッダは見ない）', async () => {
    vi.stubEnv('APP_URL', 'https://ghg.example.com/');

    const allowed = await POST(
      postRequest({ origin: 'https://ghg.example.com', host: 'localhost:3000' }),
    );
    expect(allowed.status).toBe(401);

    const rejected = await POST(
      postRequest({
        origin: 'https://evil.example.com',
        host: 'evil.example.com',
        'x-forwarded-host': 'evil.example.com',
      }),
    );
    expect(rejected.status).toBe(403);
  });

  it('APP_URL が不正な形式なら fail-closed で 403', async () => {
    vi.stubEnv('APP_URL', 'not a url');

    const response = await POST(
      postRequest({ origin: 'https://ghg.example.com', host: 'ghg.example.com' }),
    );
    expect(response.status).toBe(403);
  });
});
