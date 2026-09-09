import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  findProvisionalRecalculationTargets: vi.fn(),
  resetProvisionalCalculatedRecords: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

// getRequestLogger は next/headers に依存するため、Route の単体テストではモックする。
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: vi.fn(async () => mocks.log),
}));

vi.mock('@/features/calculation/services/provisionalRecalculation', () => ({
  findProvisionalRecalculationTargets: mocks.findProvisionalRecalculationTargets,
  resetProvisionalCalculatedRecords: mocks.resetProvisionalCalculatedRecords,
}));

import { GET, POST } from '../route';

const postRequest = (body: unknown) =>
  new Request('http://localhost/api/calculations/provisional-recalculation', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('GET /api/calculations/provisional-recalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ organizationId: 'org-id' });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.findProvisionalRecalculationTargets).not.toHaveBeenCalled();
  });

  it('ログイン中プロフィールの組織で検出する（body の組織IDは受け取らない）', async () => {
    const targets = [{ fiscalYearId: 'fy-2026', fiscalYearLabel: 'FY2026', recordCount: 5 }];
    mocks.findProvisionalRecalculationTargets.mockResolvedValue(targets);

    const response = await GET();

    expect(mocks.findProvisionalRecalculationTargets).toHaveBeenCalledWith('org-id');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ targets });
  });

  it('検出に失敗しても内部エラーの詳細は返さない', async () => {
    mocks.findProvisionalRecalculationTargets.mockRejectedValue(new Error('relation … does not exist'));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: '再算定が必要なデータの確認に失敗しました',
    });
  });
});

describe('POST /api/calculations/provisional-recalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ organizationId: 'org-id' });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);

    const response = await POST(postRequest({ fiscalYearId: 'fy-2026' }));

    expect(response.status).toBe(401);
    expect(mocks.resetProvisionalCalculatedRecords).not.toHaveBeenCalled();
  });

  it('fiscalYearId が無ければ400', async () => {
    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    expect(mocks.resetProvisionalCalculatedRecords).not.toHaveBeenCalled();
  });

  it('自組織の年度を差し戻して件数を返す', async () => {
    mocks.resetProvisionalCalculatedRecords.mockResolvedValue({
      fiscalYearId: 'fy-2026',
      fiscalYearLabel: 'FY2026',
      resetCount: 12,
    });

    const response = await POST(postRequest({ fiscalYearId: 'fy-2026' }));

    expect(mocks.resetProvisionalCalculatedRecords).toHaveBeenCalledWith({
      organizationId: 'org-id',
      fiscalYearId: 'fy-2026',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fiscalYearId: 'fy-2026',
      fiscalYearLabel: 'FY2026',
      resetCount: 12,
    });
  });

  it('他組織・存在しない年度は404（区別は返さない）', async () => {
    mocks.resetProvisionalCalculatedRecords.mockResolvedValue(null);

    const response = await POST(postRequest({ fiscalYearId: 'fy-other-org' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: '算定年度が見つかりません' });
  });

  it('差し戻しに失敗しても内部エラーの詳細は返さない', async () => {
    mocks.resetProvisionalCalculatedRecords.mockRejectedValue(new Error('permission denied'));

    const response = await POST(postRequest({ fiscalYearId: 'fy-2026' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'サーバー内部エラーが発生しました' });
  });
});
