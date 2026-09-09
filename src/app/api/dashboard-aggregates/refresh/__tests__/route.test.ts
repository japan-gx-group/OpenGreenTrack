import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

// getRequestLogger は next/headers に依存するため、Route の単体テストではモックする。
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: vi.fn(async () => mocks.log),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mocks.maybeSingle,
        }),
      }),
    }),
    rpc: mocks.rpc,
  }),
}));

import { POST } from '../route';

const postRequest = (body: unknown) =>
  new Request('http://localhost/api/dashboard-aggregates/refresh', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/dashboard-aggregates/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ organizationId: 'org-1' });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'fy-1', organizationId: 'org-1' },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('自組織の年度なら refresh_dashboard_aggregates を実行して 200 を返す', async () => {
    const response = await POST(postRequest({ fiscalYearId: 'fy-1' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('refresh_dashboard_aggregates', {
      p_organization_id: 'org-1',
      p_fiscal_year_id: 'fy-1',
    });
  });

  it('未ログインは 401 を返し RPC を呼ばない', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);

    const response = await POST(postRequest({ fiscalYearId: 'fy-1' }));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fiscalYearId が無ければ 400 を返す', async () => {
    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('他組織の年度は 403 で拒否する', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'fy-2', organizationId: 'org-other' },
      error: null,
    });

    const response = await POST(postRequest({ fiscalYearId: 'fy-2' }));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('存在しない年度は 404 を返す', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(postRequest({ fiscalYearId: 'fy-missing' }));

    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('UUID 形式でない年度IDは 404（存在しない年度扱い）を返す', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid' },
    });

    const response = await POST(postRequest({ fiscalYearId: 'not-a-uuid' }));

    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('RPC の失敗は詳細を伏せて 500 を返す', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for function refresh_dashboard_aggregates' },
    });

    const response = await POST(postRequest({ fiscalYearId: 'fy-1' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'ダッシュボード集計の更新に失敗しました',
    });
    expect(mocks.log.error).toHaveBeenCalled();
  });
});
