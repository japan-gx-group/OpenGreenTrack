// OGT の候補値の採用（サーバ側）のテスト。採用する値はサーバが OGT から取り直したものだけで、
// 画面が表示していた値（指紋）と違えば保存しないことを確かめる（T08b の改ざん防止）。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fictionalOgtCandidates,
  fictionalReportBasicInfo,
  fictionalSupplierReferences,
} from '../../__fixtures__/fictionalReport';
import { ogtCandidateFingerprint } from '../../utils/ogtAdoption';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(async () => ({ kind: 'server-client' })),
  rpc: vi.fn(),
  fetchSsbjReport: vi.fn(),
  fetchOgtCandidates: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../reportService', () => ({ fetchSsbjReport: mocks.fetchSsbjReport }));
vi.mock('../ogtCandidateService', () => ({ fetchOgtCandidates: mocks.fetchOgtCandidates }));

import { SsbjOgtAdoptionError, adoptOgtCandidates } from '../ogtAdoptionServer';

const report = {
  ...fictionalReportBasicInfo,
  fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01',
  periodEnd: '2025-03-31',
  draftRevision: 3,
};
const displayedFingerprint = ogtCandidateFingerprint(fictionalOgtCandidates, fictionalSupplierReferences);
const params = {
  reportId: report.id,
  organizationId: report.organizationId,
  actorUserId: 'user-1',
  expectedFingerprint: displayedFingerprint,
};

const reasonOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((caught: unknown) => caught);
  return error instanceof SsbjOgtAdoptionError ? error.reason : error;
};

describe('adoptOgtCandidates（サーバ）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchSsbjReport.mockResolvedValue(report);
    mocks.fetchOgtCandidates.mockResolvedValue({ candidates: fictionalOgtCandidates, suppliers: fictionalSupplierReferences });
    mocks.rpc.mockResolvedValue({ data: { adoptedAt: '2025-06-03T02:00:00+00:00' }, error: null });
  });

  it('サーバが取り直した候補値を、セッションの組織・利用者で RPC に渡す', async () => {
    await expect(adoptOgtCandidates(params)).resolves.toEqual({ adoptedAt: '2025-06-03T02:00:00+00:00' });
    expect(mocks.fetchSsbjReport).toHaveBeenCalledWith({ kind: 'server-client' }, report.id);
    expect(mocks.rpc).toHaveBeenCalledWith('adopt_ssbj_ogt_values', {
      p_report_id: report.id,
      p_organization_id: report.organizationId,
      p_actor_user_id: 'user-1',
      p_candidates: fictionalOgtCandidates,
      p_supplier_references: fictionalSupplierReferences,
    });
  });

  it('OGT の値が画面の表示から変わっていれば保存しない（見ていない値を採用させない）', async () => {
    const changed = fictionalOgtCandidates.map((candidate, index) =>
      index === 0 ? { ...candidate, value: { state: 'answered' as const, value: '999.999' } } : candidate);
    mocks.fetchOgtCandidates.mockResolvedValue({ candidates: changed, suppliers: fictionalSupplierReferences });
    expect(await reasonOf(adoptOgtCandidates(params))).toBe('candidates_changed');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('見えない（他組織・存在しない）レポートと、組織が一致しないレポートは見つからない扱い', async () => {
    mocks.fetchSsbjReport.mockResolvedValue(null);
    expect(await reasonOf(adoptOgtCandidates(params))).toBe('report_not_found');
    mocks.fetchSsbjReport.mockResolvedValue({ ...report, organizationId: 'other-org' });
    expect(await reasonOf(adoptOgtCandidates(params))).toBe('report_not_found');
    expect(mocks.fetchOgtCandidates).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('RPC の P2041 は見つからない扱い、それ以外の失敗は例外', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P2041', message: 'not found' } });
    expect(await reasonOf(adoptOgtCandidates(params))).toBe('report_not_found');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    await expect(adoptOgtCandidates(params)).rejects.toThrow('OGT の値の採用に失敗しました');
  });
});
