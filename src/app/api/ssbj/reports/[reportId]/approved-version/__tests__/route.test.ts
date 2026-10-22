// GET /api/ssbj/reports/[reportId]/approved-version の Route Handler テスト。
// 認証ガード・入力検証・ロールの確認と、組織はセッションから取ること、内部記録を除いた版だけを返すことを検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fictionalSnapshot, fictionalVersion } from '@/features/ssbj/__fixtures__/fictionalReport';
import { toSsbjDisclosedSnapshot } from '@/features/ssbj/utils/disclosedSnapshot';

const mocks = vi.hoisted(() => ({
  guardSsbjRole: vi.fn(),
  getCurrentProfile: vi.fn(),
  fetchSsbjApprovedVersion: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: mocks.getCurrentProfile }));
vi.mock('@/lib/logging/requestLogger', () => ({ getRequestLogger: vi.fn(async () => mocks.log) }));
vi.mock('@/features/ssbj/services/approvedVersionServer', () => ({
  fetchSsbjApprovedVersion: mocks.fetchSsbjApprovedVersion,
}));
vi.mock('@/features/ssbj/services/roleServer', () => ({ guardSsbjRole: mocks.guardSsbjRole }));

import { GET } from '../route';

const REPORT_ID = fictionalVersion.reportId;
const request = () => new Request(`http://localhost/api/ssbj/reports/${REPORT_ID}/approved-version`);
const params = (reportId: string = REPORT_ID) => ({ params: Promise.resolve({ reportId }) });
const approved = {
  id: fictionalVersion.id,
  reportId: REPORT_ID,
  versionNumber: 1,
  createdAt: fictionalVersion.createdAt,
  note: '承認時の保存版',
  sourceVersionId: null,
  createdByUserId: 'user-approver',
  creatorName: '確認 三郎',
  snapshot: toSsbjDisclosedSnapshot(fictionalSnapshot).snapshot,
};

describe('GET /api/ssbj/reports/[reportId]/approved-version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
    mocks.guardSsbjRole.mockResolvedValue(null);
    mocks.fetchSsbjApprovedVersion.mockResolvedValue({ version: approved, unclassifiedPaths: [] });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    expect((await GET(request(), params())).status).toBe(401);
    expect(mocks.fetchSsbjApprovedVersion).not.toHaveBeenCalled();
  });

  it('UUIDでないreportIdは404', async () => {
    expect((await GET(request(), params('not-a-uuid'))).status).toBe(404);
    expect(mocks.fetchSsbjApprovedVersion).not.toHaveBeenCalled();
  });

  it('自組織の承認済みのレポートなら200で、内部記録を除いた承認した版を返す（組織はセッションから）', async () => {
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(approved);
    expect(JSON.stringify(body)).not.toContain('internalNote');
    expect(mocks.fetchSsbjApprovedVersion).toHaveBeenCalledWith({ reportId: REPORT_ID, organizationId: 'org-1' });
    expect(mocks.log.warn).not.toHaveBeenCalled();
  });

  it('どの SSBJ のロールでも読める権限（view_approved）で確かめる', async () => {
    await GET(request(), params());
    expect(mocks.guardSsbjRole).toHaveBeenCalledWith(
      { id: 'user-1', organizationId: 'org-1' }, 'view_approved', expect.any(Function),
    );
  });

  it('見えない・承認済みでない・承認した版が無いレポートは404、想定外の失敗は500', async () => {
    mocks.fetchSsbjApprovedVersion.mockResolvedValueOnce(null);
    expect((await GET(request(), params())).status).toBe(404);
    mocks.fetchSsbjApprovedVersion.mockRejectedValueOnce(new Error('boom'));
    expect((await GET(request(), params())).status).toBe(500);
    expect(mocks.log.error).toHaveBeenCalled();
  });

  it('開示するか決めていない項目を除いたときは、除いた版を返したうえで記録する', async () => {
    mocks.fetchSsbjApprovedVersion.mockResolvedValueOnce({ version: approved, unclassifiedPaths: ['sections.new_section'] });
    expect((await GET(request(), params())).status).toBe(200);
    expect(mocks.log.warn).toHaveBeenCalledWith(expect.objectContaining({ paths: ['sections.new_section'] }), expect.any(String));
  });

  it('SSBJ のロールが許さなければ 403 で、service_role の処理を呼ばない', async () => {
    mocks.guardSsbjRole.mockResolvedValue({ status: 403, error: 'この操作の権限がありません' });
    const response = await GET(request(), params());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('この操作の権限がありません');
    expect(mocks.fetchSsbjApprovedVersion).not.toHaveBeenCalled();
  });

  it('SSBJ のロールを確かめられなければ 500（確かめないまま進めない）', async () => {
    mocks.guardSsbjRole.mockResolvedValue({ status: 500, error: 'サーバー内部エラーが発生しました' });
    expect((await GET(request(), params())).status).toBe(500);
    expect(mocks.fetchSsbjApprovedVersion).not.toHaveBeenCalled();
  });
});
