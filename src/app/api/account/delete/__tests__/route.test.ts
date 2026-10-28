import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// CSRF 緩和（Origin とサイト自身のホストの比較）と、最後のメンバー・最後の管理者のガードを検証する。
// Origin の検証では getUser を「未ログイン」にして 401 で止め、Origin 判定を通過したことの目印にする。
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: null as null | { id: string; organizationId: string; role: string },
  memberCount: 0,
  adminCount: 0,
  deleteUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@/lib/supabase/admin', () => {
  // 件数の問い合わせ（select(…, { count, head })）。eq('role', …) が付けば管理者の人数を返す。
  class CountQuery implements PromiseLike<{ count: number; error: null }> {
    private byRole = false;

    eq(column: string) {
      if (column === 'role') this.byRole = true;
      return this;
    }

    then<TResult1 = { count: number; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { count: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve({
        count: this.byRole ? mocks.adminCount : mocks.memberCount,
        error: null,
      }).then(onfulfilled, onrejected);
    }
  }

  return {
    createAdminClient: () => ({
      from: () => ({
        select: (_columns: string, options?: { head?: boolean }) =>
          options?.head
            ? new CountQuery()
            : {
                eq: () => ({
                  single: async () => ({
                    data: mocks.profile,
                    error: mocks.profile ? null : { message: 'not found' },
                  }),
                }),
              },
      }),
      auth: { admin: { deleteUser: mocks.deleteUser } },
    }),
  };
});

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

describe('POST /api/account/delete の最後のメンバー・最後の管理者のガード', () => {
  const sameOrigin = () =>
    postRequest({ origin: 'https://ghg.example.com', host: 'ghg.example.com' });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.deleteUser.mockResolvedValue({ error: null });
    mocks.memberCount = 3;
    mocks.adminCount = 1;
  });

  it('最後の管理者の退会は 409 で拒否し、削除しない', async () => {
    mocks.profile = { id: 'user-1', organizationId: 'org-1', role: 'admin' };
    const response = await POST(sameOrigin());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: '組織で最後の管理者のため削除できません。先に別のメンバーを管理者にしてください',
    });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('ほかにも管理者がいれば、管理者も退会できる', async () => {
    mocks.profile = { id: 'user-1', organizationId: 'org-1', role: 'admin' };
    mocks.adminCount = 2;
    const response = await POST(sameOrigin());
    expect(response.status).toBe(200);
    expect(mocks.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('メンバーは管理者の人数にかかわらず退会できる', async () => {
    mocks.profile = { id: 'user-1', organizationId: 'org-1', role: 'logger' };
    const response = await POST(sameOrigin());
    expect(response.status).toBe(200);
    expect(mocks.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('組織で最後の 1 人なら、管理者かどうかにかかわらず 409', async () => {
    mocks.profile = { id: 'user-1', organizationId: 'org-1', role: 'logger' };
    mocks.memberCount = 1;
    const response = await POST(sameOrigin());
    expect(response.status).toBe(409);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
