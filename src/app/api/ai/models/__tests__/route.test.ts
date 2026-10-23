import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listAvailableModels: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/authz', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/ai/models', () => ({ listAvailableModels: mocks.listAvailableModels }));
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => ({ warn: mocks.warn, error: vi.fn() }),
}));

import { GET } from '../route';

const request = () => new NextRequest('http://localhost/api/ai/models');
const admin = { id: 'admin-1', organizationId: 'org-1', email: 'a@example.com', fullName: null, role: 'admin' };

describe('GET /api/ai/models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ ok: true, profile: admin });
  });

  it('管理者でなければ 403 で、一覧を取らない', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, error: '管理者のみ操作できます' });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.listAvailableModels).not.toHaveBeenCalled();
  });

  it('自分の組織で一覧を取り、提供元とモデルだけを返す', async () => {
    mocks.listAvailableModels.mockResolvedValue({
      ok: true,
      provider: 'anthropic',
      models: [{ id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', createdAt: null, deprecated: false, retiresOn: null }],
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.listAvailableModels.mock.calls[0][0]).toBe('org-1');
    await expect(response.json()).resolves.toEqual({
      provider: 'anthropic',
      models: [{ id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', createdAt: null, deprecated: false, retiresOn: null }],
    });
  });

  it('失敗したら決まった文を返し、理由はログにだけ残す', async () => {
    mocks.listAvailableModels.mockResolvedValue({
      ok: false,
      status: 502,
      error: 'API キーが無効か、権限がありません。サーバに設定した API キーを確認してください',
      reason: 'invalid_key',
    });
    const response = await GET(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: 'API キーが無効か、権限がありません。サーバに設定した API キーを確認してください' });
    expect(mocks.warn).toHaveBeenCalledWith({ reason: 'invalid_key' }, expect.any(String));
  });

  it('回数の上限では 429 と Retry-After を返す', async () => {
    mocks.listAvailableModels.mockResolvedValue({ ok: false, status: 429, error: '...', reason: 'local_rate_limited' });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });
});
