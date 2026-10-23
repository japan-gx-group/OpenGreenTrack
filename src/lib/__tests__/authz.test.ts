import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

import { ADMIN_ONLY_MESSAGE, SIGNED_OUT_MESSAGE, requireAdmin } from '../authz';

const profile = (role: 'admin' | 'logger' | 'viewer') => ({
  id: 'user-1',
  organizationId: 'org-1',
  email: 'user@example.com',
  fullName: null,
  role,
});

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('管理者なら通し、プロフィールを返す', async () => {
    mocks.getCurrentProfile.mockResolvedValue(profile('admin'));
    await expect(requireAdmin()).resolves.toEqual({ ok: true, profile: profile('admin') });
  });

  it('メンバー（logger・viewer）は 403', async () => {
    for (const role of ['logger', 'viewer'] as const) {
      mocks.getCurrentProfile.mockResolvedValue(profile(role));
      await expect(requireAdmin()).resolves.toEqual({
        ok: false,
        status: 403,
        error: ADMIN_ONLY_MESSAGE,
      });
    }
  });

  it('ログインしていなければ 401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    await expect(requireAdmin()).resolves.toEqual({
      ok: false,
      status: 401,
      error: SIGNED_OUT_MESSAGE,
    });
  });
});
