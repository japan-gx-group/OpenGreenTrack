import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  resetRecordsCalculatedWithFactor: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

// getRequestLogger は next/headers に依存するため、Route の単体テストではモックする。
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: vi.fn(async () => mocks.log),
}));

vi.mock('@/features/calculation/services/factorRecalculation', () => ({
  resetRecordsCalculatedWithFactor: mocks.resetRecordsCalculatedWithFactor,
}));

import { POST } from '../route';

const postRequest = (body: unknown) =>
  new Request('http://localhost/api/calculations/factor-recalculation', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/calculations/factor-recalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ organizationId: 'org-id' });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);

    const response = await POST(postRequest({ factorId: 'factor-1' }));

    expect(response.status).toBe(401);
    expect(mocks.resetRecordsCalculatedWithFactor).not.toHaveBeenCalled();
  });

  it('factorId が無ければ400', async () => {
    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    expect(mocks.resetRecordsCalculatedWithFactor).not.toHaveBeenCalled();
  });

  it('ログイン中プロフィールの組織で差し戻し、件数と年度を返す（body の組織IDは受け取らない）', async () => {
    const result = { resetCount: 5, skippedCount: 0, fiscalYearIds: ['fy-2026'] };
    mocks.resetRecordsCalculatedWithFactor.mockResolvedValue(result);

    const response = await POST(postRequest({ factorId: 'factor-1', organizationId: 'other-org' }));

    expect(mocks.resetRecordsCalculatedWithFactor).toHaveBeenCalledWith({
      organizationId: 'org-id',
      factorId: 'factor-1',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
  });

  it('公式係数・他組織・存在しない係数は404（区別は返さない）', async () => {
    mocks.resetRecordsCalculatedWithFactor.mockResolvedValue(null);

    const response = await POST(postRequest({ factorId: 'official-factor' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: '排出係数が見つかりません' });
  });

  it('差し戻しに失敗しても内部エラーの詳細は返さない', async () => {
    mocks.resetRecordsCalculatedWithFactor.mockRejectedValue(new Error('permission denied'));

    const response = await POST(postRequest({ factorId: 'factor-1' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'サーバー内部エラーが発生しました' });
  });
});
