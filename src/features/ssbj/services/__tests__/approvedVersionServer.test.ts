// 承認した保存版（閲覧者向け）を読むサーバ側処理のテスト。自組織の承認済みのレポートの承認した版だけを返し、
// 内部メモ・内部記録を除くことを確かめる。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fictionalSnapshot, fictionalVersion } from '../../__fixtures__/fictionalReport';
import { fictionalInternalTexts } from '../../__fixtures__/fictionalReportTexts';

type Result = { data: unknown; error: { message: string } | null };
const mocks = vi.hoisted(() => ({
  results: {} as Record<string, Result>,
  filters: {} as Record<string, [string, unknown][]>,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      mocks.filters[table] = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          mocks.filters[table].push([column, value]);
          return builder;
        },
        maybeSingle: async () => mocks.results[table] ?? { data: null, error: null },
      };
      return builder;
    },
  }),
}));

import { fetchSsbjApprovedVersion } from '../approvedVersionServer';

const REPORT_ID = fictionalVersion.reportId;
const ORG_ID = fictionalSnapshot.report.organizationId;
const params = { reportId: REPORT_ID, organizationId: ORG_ID };
const versionRow = {
  id: fictionalVersion.id,
  reportId: REPORT_ID,
  versionNumber: 1,
  createdAt: fictionalVersion.createdAt,
  note: '承認時の保存版',
  createdByUserId: 'user-approver',
  snapshot: fictionalSnapshot,
};

beforeEach(() => {
  mocks.results = {
    ssbj_reports: { data: { status: 'approved', approvedVersionId: fictionalVersion.id }, error: null },
    ssbj_report_versions: { data: versionRow, error: null },
    profiles: { data: { fullName: '確認 三郎', email: 'member3-a@example.com' }, error: null },
  };
  mocks.filters = {};
});

describe('fetchSsbjApprovedVersion', () => {
  it('自組織の承認済みのレポートの承認した版を、内部メモ・内部記録を除いて返す', async () => {
    const result = await fetchSsbjApprovedVersion(params);
    expect(result?.unclassifiedPaths).toEqual([]);
    expect(result?.version).toMatchObject({
      id: fictionalVersion.id, reportId: REPORT_ID, versionNumber: 1, note: '承認時の保存版',
      sourceVersionId: null, createdByUserId: 'user-approver', creatorName: '確認 三郎',
    });
    const json = JSON.stringify(result?.version.snapshot);
    for (const text of fictionalInternalTexts) expect(json, text).not.toContain(text);
    expect(result?.version.snapshot.report).toEqual(fictionalSnapshot.report);
  });

  it('レポート・保存版・作成者は、セッションの組織と承認した版の ID で絞って読む', async () => {
    await fetchSsbjApprovedVersion(params);
    expect(mocks.filters.ssbj_reports).toEqual([['id', REPORT_ID], ['organizationId', ORG_ID]]);
    expect(mocks.filters.ssbj_report_versions).toEqual([
      ['id', fictionalVersion.id], ['reportId', REPORT_ID], ['organizationId', ORG_ID],
    ]);
    expect(mocks.filters.profiles).toEqual([['id', 'user-approver'], ['organizationId', ORG_ID]]);
  });

  it('レポートが無い・承認済みでない・承認した版が無いときは null（保存版を読まない）', async () => {
    for (const report of [null, { status: 'in_review', approvedVersionId: null }, { status: 'approved', approvedVersionId: null }]) {
      mocks.results.ssbj_reports = { data: report, error: null };
      mocks.filters = {};
      await expect(fetchSsbjApprovedVersion(params)).resolves.toBeNull();
      expect(mocks.filters.ssbj_report_versions).toBeUndefined();
    }
  });

  it('承認した版の行が無ければ null', async () => {
    mocks.results.ssbj_report_versions = { data: null, error: null };
    await expect(fetchSsbjApprovedVersion(params)).resolves.toBeNull();
  });

  it('作成者が分からなければ「不明」にする', async () => {
    mocks.results.profiles = { data: null, error: { message: 'boom' } };
    await expect(fetchSsbjApprovedVersion(params)).resolves.toMatchObject({ version: { creatorName: '不明' } });
  });

  it('読み込みに失敗したら例外にする', async () => {
    mocks.results.ssbj_reports = { data: null, error: { message: 'boom' } };
    await expect(fetchSsbjApprovedVersion(params)).rejects.toThrow('レポートの取得に失敗しました');
    mocks.results.ssbj_reports = { data: { status: 'approved', approvedVersionId: fictionalVersion.id }, error: null };
    mocks.results.ssbj_report_versions = { data: null, error: { message: 'boom' } };
    await expect(fetchSsbjApprovedVersion(params)).rejects.toThrow('承認した保存版の取得に失敗しました');
  });
});
