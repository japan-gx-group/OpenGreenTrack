import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  profile: null as null | { id: string; organizationId: string; role: string },
  after: vi.fn(),
  finalize: vi.fn(),
  createUploadUrl: vi.fn(),
  removeStale: vi.fn(),
  deleteFile: vi.fn(),
}));

// after() はリクエストコンテキスト外では実行できないため、呼び出しの記録だけに差し替える。
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: async () => mocks.profile }));
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/features/activity-evidence/services/evidenceServer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/activity-evidence/services/evidenceServer')>()),
  finalizeEvidenceUpload: mocks.finalize,
  createEvidenceUploadUrl: mocks.createUploadUrl,
  removeStaleEvidenceUploads: mocks.removeStale,
  deleteEvidenceFile: mocks.deleteFile,
}));

import { resetEvidenceUploadUrlQuota } from '@/features/activity-evidence/services/evidenceServer';
import { DELETE as deleteEvidence } from '../route';

const ORG = '11111111-1111-1111-1111-111111111111';
const FILE_ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  mocks.profile = { id: 'member-1', organizationId: ORG, role: 'member' };
  for (const mock of [mocks.after, mocks.finalize, mocks.createUploadUrl, mocks.removeStale, mocks.deleteFile]) mock.mockReset();
  resetEvidenceUploadUrlQuota();
});

describe('DELETE /api/activity-evidence/[id]', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it('ログインしていなければ 401、ID の形が違えば 404', async () => {
    mocks.profile = null;
    expect((await deleteEvidence(new Request('http://localhost/x'), params(FILE_ID))).status).toBe(401);
    mocks.profile = { id: 'member-1', organizationId: ORG, role: 'member' };
    expect((await deleteEvidence(new Request('http://localhost/x'), params('../x'))).status).toBe(404);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('メンバーも消せる（204）。紐づいていれば 409 の文を返す', async () => {
    mocks.deleteFile.mockResolvedValueOnce({ ok: true });
    expect((await deleteEvidence(new Request('http://localhost/x'), params(FILE_ID))).status).toBe(204);
    expect(mocks.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ id: FILE_ID, caller: mocks.profile }));

    mocks.deleteFile.mockResolvedValueOnce({ ok: false, status: 409, errorMessage: '紐づいています' });
    const conflict = await deleteEvidence(new Request('http://localhost/x'), params(FILE_ID));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: '紐づいています' });
  });
});
