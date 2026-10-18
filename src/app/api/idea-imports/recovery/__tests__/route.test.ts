import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createAdminClient: vi.fn(() => ({ admin: true })),
  recoverStaleIdeaImports: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

// getRequestLogger は next/headers に依存するため、Route の単体テストではモックする。
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: vi.fn(async () => mocks.log),
}));

vi.mock('@/features/factors/services/ideaImportServer', () => ({
  recoverStaleIdeaImports: mocks.recoverStaleIdeaImports,
}));

import { POST } from '../route';

describe('POST /api/idea-imports/recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ organizationId: 'org-id' });
    mocks.recoverStaleIdeaImports.mockResolvedValue(undefined);
  });

  it('未ログインは401で、回収しない', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.recoverStaleIdeaImports).not.toHaveBeenCalled();
  });

  it('ログイン中プロフィールの組織の滞留した取込を回収し、204を返す', async () => {
    const response = await POST();

    expect(mocks.recoverStaleIdeaImports).toHaveBeenCalledWith({ admin: true }, 'org-id', mocks.log);
    expect(response.status).toBe(204);
  });

  it('予期しない失敗でも内部エラーの詳細は返さない', async () => {
    mocks.recoverStaleIdeaImports.mockRejectedValue(new Error('relation does not exist'));

    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'サーバー内部エラーが発生しました' });
  });
});
