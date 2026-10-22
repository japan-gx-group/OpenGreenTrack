// GET /api/ssbj/reports/[reportId]/preview の Route Handler テスト（T12）。
// 認証ガード・入力検証と、組織はセッションから取ることを検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guardSsbjRole: vi.fn(),
  getCurrentProfile: vi.fn(),
  previewSsbjReport: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: mocks.getCurrentProfile }));
vi.mock('@/lib/logging/requestLogger', () => ({ getRequestLogger: vi.fn(async () => mocks.log) }));
vi.mock('@/features/ssbj/services/previewServer', () => ({ previewSsbjReport: mocks.previewSsbjReport }));

vi.mock('@/features/ssbj/services/roleServer', () => ({ guardSsbjRole: mocks.guardSsbjRole }));

import { GET } from '../route';

const REPORT_ID = '019890ab-1234-4cde-8f01-23456789abcd';
const request = () => new Request(`http://localhost/api/ssbj/reports/${REPORT_ID}/preview`);
const params = (reportId: string = REPORT_ID) => ({ params: Promise.resolve({ reportId }) });

describe('GET /api/ssbj/reports/[reportId]/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
    mocks.guardSsbjRole.mockResolvedValue(null);
    mocks.previewSsbjReport.mockResolvedValue({ draftRevision: 3, snapshot: { schemaVersion: 1 } });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    expect((await GET(request(), params())).status).toBe(401);
    expect(mocks.previewSsbjReport).not.toHaveBeenCalled();
  });

  it('UUIDでないreportIdは404', async () => {
    expect((await GET(request(), params('not-a-uuid'))).status).toBe(404);
  });

  it('自組織のレポートなら200で作業中の内容を返す（組織はセッションから）', async () => {
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draftRevision: 3, snapshot: { schemaVersion: 1 } });
    expect(mocks.previewSsbjReport).toHaveBeenCalledWith({ reportId: REPORT_ID, organizationId: 'org-1' });
  });

  it('見えないレポートは404、想定外の失敗は500', async () => {
    mocks.previewSsbjReport.mockResolvedValueOnce(null);
    expect((await GET(request(), params())).status).toBe(404);
    mocks.previewSsbjReport.mockRejectedValueOnce(new Error('boom'));
    expect((await GET(request(), params())).status).toBe(500);
    expect(mocks.log.error).toHaveBeenCalled();
  });
  it('SSBJ のロールが許さなければ 403 で、service_role の処理を呼ばない（docs/authorization-matrix.md §2.2）', async () => {
    mocks.guardSsbjRole.mockResolvedValue({ status: 403, error: 'SSBJ のロールが閲覧者のため、この操作はできません' });
    const response = await GET(request(), params());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('閲覧者のため');
    expect(mocks.guardSsbjRole).toHaveBeenCalledWith({ id: 'user-1', organizationId: 'org-1' }, 'view_working', expect.any(Function));
    expect(mocks.previewSsbjReport).not.toHaveBeenCalled();
  });

  it('SSBJ のロールを確かめられなければ 500（確かめないまま進めない）', async () => {
    mocks.guardSsbjRole.mockResolvedValue({ status: 500, error: 'サーバー内部エラーが発生しました' });
    expect((await GET(request(), params())).status).toBe(500);
    expect(mocks.previewSsbjReport).not.toHaveBeenCalled();
  });
});
