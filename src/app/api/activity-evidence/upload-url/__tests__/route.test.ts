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
import { POST as postUploadUrl } from '../route';

const ORG = '11111111-1111-1111-1111-111111111111';
const UPLOAD_PATH = `${ORG}/activity-evidence/33333333-3333-4333-8333-333333333333`;

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  mocks.profile = { id: 'member-1', organizationId: ORG, role: 'member' };
  for (const mock of [mocks.after, mocks.finalize, mocks.createUploadUrl, mocks.removeStale, mocks.deleteFile]) mock.mockReset();
  resetEvidenceUploadUrlQuota();
});

describe('POST /api/activity-evidence/upload-url', () => {
  it('ログインしていなければ 401', async () => {
    mocks.profile = null;
    expect((await postUploadUrl(jsonRequest('http://localhost/x', { fileName: 'a.pdf', fileSize: 10 }))).status).toBe(401);
  });

  it('申告のファイル名・大きさで先に弾く', async () => {
    const response = await postUploadUrl(jsonRequest('http://localhost/x', { fileName: 'a.exe', fileSize: 10 }));
    expect(response.status).toBe(400);
    expect(mocks.createUploadUrl).not.toHaveBeenCalled();
  });

  it('メンバーにも自組織のフォルダの URL を発行し、取り残しの掃除は応答の後に回す', async () => {
    mocks.createUploadUrl.mockResolvedValue({ ok: true, storagePath: UPLOAD_PATH, token: 'token-1' });
    const response = await postUploadUrl(jsonRequest('http://localhost/x', { fileName: '9月分.pdf', fileSize: 2048 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bucket: 'upload-quarantine', storagePath: UPLOAD_PATH, token: 'token-1' });
    expect(mocks.createUploadUrl).toHaveBeenCalledWith(expect.anything(), ORG);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.removeStale).not.toHaveBeenCalled();
  });

  it('発行が続けば 429 と Retry-After', async () => {
    mocks.createUploadUrl.mockResolvedValue({ ok: true, storagePath: UPLOAD_PATH, token: 't' });
    for (let i = 0; i < 40; i += 1) {
      await postUploadUrl(jsonRequest('http://localhost/x', { fileName: 'a.pdf', fileSize: 10 }));
    }
    const limited = await postUploadUrl(jsonRequest('http://localhost/x', { fileName: 'a.pdf', fileSize: 10 }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('600');
  });
});

