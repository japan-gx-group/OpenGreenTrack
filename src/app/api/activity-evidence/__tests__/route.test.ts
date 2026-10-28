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
import { POST as postFinalize } from '../route';

const ORG = '11111111-1111-1111-1111-111111111111';
const UPLOAD_PATH = `${ORG}/activity-evidence/33333333-3333-4333-8333-333333333333`;
const FILE_ID = '44444444-4444-4444-8444-444444444444';

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  mocks.profile = { id: 'member-1', organizationId: ORG, role: 'member' };
  for (const mock of [mocks.after, mocks.finalize, mocks.createUploadUrl, mocks.removeStale, mocks.deleteFile]) mock.mockReset();
  resetEvidenceUploadUrlQuota();
});

describe('POST /api/activity-evidence', () => {
  it('他組織・任意のパスは、Storage に触れる前に 400', async () => {
    const response = await postFinalize(
      jsonRequest('http://localhost/x', { storagePath: UPLOAD_PATH.replace(ORG, '22222222-2222-2222-2222-222222222222'), fileName: 'a.pdf' }),
    );
    expect(response.status).toBe(400);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('保存した帳票を 201 で返す。変換前の形式は PNG・JPEG だけを受け取る', async () => {
    mocks.finalize.mockResolvedValue({ ok: true, file: { id: FILE_ID, fileName: 'a.webp' } });
    const response = await postFinalize(
      jsonRequest('http://localhost/x', { storagePath: UPLOAD_PATH, fileName: 'a.webp', convertedFrom: 'image/png' }),
    );
    expect(response.status).toBe(201);
    expect(mocks.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ storagePath: UPLOAD_PATH, fileName: 'a.webp', convertedFrom: 'image/png', caller: mocks.profile }),
    );

    await postFinalize(jsonRequest('http://localhost/x', { storagePath: UPLOAD_PATH, fileName: 'a.webp', convertedFrom: 'text/html' }));
    expect(mocks.finalize.mock.calls[1][0].convertedFrom).toBeNull();
  });

  it('中身の確認で断られたら、その文と状態をそのまま返す', async () => {
    mocks.finalize.mockResolvedValue({ ok: false, status: 400, errorMessage: 'PDF・PNG・JPEG・WebP のファイルではありません' });
    const response = await postFinalize(jsonRequest('http://localhost/x', { storagePath: UPLOAD_PATH, fileName: 'a.pdf' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'PDF・PNG・JPEG・WebP のファイルではありません' });
  });
});

