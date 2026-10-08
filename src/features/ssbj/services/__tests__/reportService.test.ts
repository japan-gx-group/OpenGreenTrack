import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FICTIONAL_FISCAL_YEAR, fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';
import type { SsbjReportBasicInfoInput } from '../../utils/reportValidation';
import { SSBJ_EDIT_CONFLICT_MESSAGE, SsbjEditConflictError } from '../../utils/writeError';
import {
  getSsbjReport,
  toSsbjReportRecord,
  toSsbjReportWorkingRecord,
  updateSsbjReportBasicInfo,
  type SsbjReportRow,
} from '../reportService';

// Supabase への問い合わせは「取得結果 → 画面の型」への変換と、ID 不正時の扱い、基本情報の更新の競合検知を検証する。
// 更新は、eq の条件に合う行だけを書き換える 1 行だけの DB（db.row）で動かし、2 つの画面からの保存を再現する。
// 基本情報の列が変わったときに版数を進めるのは DB のトリガー（bump_ssbj_reports_own_draft_revision）で、ここではその動きを真似る。
type Query = { update: Record<string, unknown> | null; filters: [string, unknown][] };
const db = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));
const BASIC_INFO_COLUMNS = [
  'title', 'purpose', 'reportingScope', 'standardVersion', 'parentCompanyName', 'parentRelationship',
  'ownershipPercentage', 'measurementApproach', 'industryCode',
];
type QueryResult = { data: unknown; error: { code: string; message: string } | null };
const runQuery = async ({ update, filters }: Query): Promise<QueryResult> => {
  const row = db.row;
  if (!row || !filters.every(([column, value]) => row[column] === value)) return { data: null, error: null };
  if (update) {
    const changed = BASIC_INFO_COLUMNS.some(column => column in update && update[column] !== row[column]);
    Object.assign(row, update);
    if (changed) {
      row.draftRevision = (row.draftRevision as number) + 1;
      row.basicInfoRevision = (row.basicInfoRevision as number) + 1;
    }
  }
  return { data: { ...row }, error: null };
};
const maybeSingle = vi.fn((query: Query) => runQuery(query));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const query: Query = { update: null, filters: [] };
      const builder = {
        select: () => builder,
        update: (columns: Record<string, unknown>) => {
          query.update = columns;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          query.filters.push([column, value]);
          return builder;
        },
        maybeSingle: () => maybeSingle(query),
      };
      return builder;
    },
  }),
}));

const row = (fiscalYears: SsbjReportRow['fiscal_years']): SsbjReportRow => ({
  id: fictionalReportBasicInfo.id,
  organizationId: fictionalReportBasicInfo.organizationId,
  fiscalYearId: fictionalReportBasicInfo.fiscalYearId,
  title: fictionalReportBasicInfo.title,
  purpose: fictionalReportBasicInfo.purpose,
  reportingScope: fictionalReportBasicInfo.reportingScope,
  standardVersion: null,
  parentCompanyName: fictionalReportBasicInfo.parentCompanyName,
  parentRelationship: fictionalReportBasicInfo.parentRelationship,
  ownershipPercentage: fictionalReportBasicInfo.ownershipPercentage,
  measurementApproach: fictionalReportBasicInfo.measurementApproach,
  industryCode: fictionalReportBasicInfo.industryCode,
  createdAt: fictionalReportBasicInfo.createdAt,
  updatedAt: fictionalReportBasicInfo.updatedAt,
  draftRevision: 3,
  basicInfoRevision: 2,
  status: 'approved',
  approverUserId: 'user-approver',
  approvedAt: '2025-06-05T00:00:00.000Z',
  approvedByUserId: 'user-approver',
  approvedVersionId: 'version-1',
  statusChangedAt: '2025-06-05T00:00:00.000Z',
  fiscal_years: fiscalYears,
});

const EMBED = {
  label: FICTIONAL_FISCAL_YEAR.label,
  startDate: FICTIONAL_FISCAL_YEAR.startDate,
  endDate: FICTIONAL_FISCAL_YEAR.endDate,
};

beforeEach(() => {
  maybeSingle.mockImplementation((query: Query) => runQuery(query));
  db.row = null;
});

afterEach(() => {
  maybeSingle.mockReset();
});

describe('toSsbjReportRecord', () => {
  it('埋め込んだ年度のラベル・期間を添え、未入力の任意項目は null のまま返す', () => {
    expect(toSsbjReportRecord(row(EMBED))).toEqual({
      ...fictionalReportBasicInfo,
      standardVersion: null,
      fiscalYearLabel: '2024年度',
      periodStart: '2024-04-01',
      periodEnd: '2025-03-31',
    });
  });

  it('年度の埋め込みが配列で返っても同じ結果になる', () => {
    expect(toSsbjReportRecord(row([EMBED]))).toEqual(toSsbjReportRecord(row(EMBED)));
  });

  it('年度が取れない行は例外にする', () => {
    expect(() => toSsbjReportRecord(row(null))).toThrow('算定年度を取得できませんでした');
  });

  it('draftRevision・状態を含めない（保存版の report と同じ形を保つ）', () => {
    expect(toSsbjReportRecord(row(EMBED))).not.toHaveProperty('draftRevision');
    expect(toSsbjReportRecord(row(EMBED))).not.toHaveProperty('review');
  });
});

describe('toSsbjReportWorkingRecord', () => {
  it('SsbjReportRecord に draftRevision・basicInfoRevision と状態・承認の記録を添える', () => {
    expect(toSsbjReportWorkingRecord(row(EMBED))).toEqual({
      ...toSsbjReportRecord(row(EMBED)),
      draftRevision: 3,
      basicInfoRevision: 2,
      review: {
        status: 'approved',
        approverUserId: 'user-approver',
        approvedAt: '2025-06-05T00:00:00.000Z',
        approvedByUserId: 'user-approver',
        approvedVersionId: 'version-1',
        statusChangedAt: '2025-06-05T00:00:00.000Z',
      },
    });
  });
});

describe('getSsbjReport', () => {
  it('該当なし（存在しない・他組織で RLS により不可視）は null', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getSsbjReport('5b1f0000-0000-4000-8000-0000000000ff')).resolves.toBeNull();
  });

  it('UUID 形式でない ID（22P02）は通信エラーにせず null', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: '22P02', message: 'invalid input syntax' } });
    await expect(getSsbjReport('not-a-uuid')).resolves.toBeNull();
  });

  it('それ以外のエラーは例外にする', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    await expect(getSsbjReport(fictionalReportBasicInfo.id)).rejects.toThrow('SSBJレポートの取得に失敗しました');
  });

  it('取得できた行は draftRevision 付きのレコードに変換する', async () => {
    maybeSingle.mockResolvedValue({ data: row(EMBED), error: null });
    await expect(getSsbjReport(fictionalReportBasicInfo.id)).resolves.toMatchObject({
      id: fictionalReportBasicInfo.id,
      fiscalYearLabel: '2024年度',
      draftRevision: 3,
    });
  });
});

describe('updateSsbjReportBasicInfo（2 つの画面からの保存）', () => {
  // 画面 A・B が同じレポートを同じ時点で開き、それぞれの基本情報フォームに読込時の値を入れている。
  const loaded = toSsbjReportWorkingRecord(row(EMBED));
  const formOf = (patch: Partial<SsbjReportBasicInfoInput>): SsbjReportBasicInfoInput => ({
    title: loaded.title,
    purpose: loaded.purpose,
    reportingScope: loaded.reportingScope,
    standardVersion: loaded.standardVersion,
    parentCompanyName: loaded.parentCompanyName,
    parentRelationship: loaded.parentRelationship,
    ownershipPercentage: loaded.ownershipPercentage,
    measurementApproach: loaded.measurementApproach,
    industryCode: loaded.industryCode,
    ...patch,
  });

  beforeEach(() => {
    db.row = { ...row(EMBED) };
  });

  it('読込時の基本情報の版数を更新の条件に含め、成功したら進んだ版数を返す', async () => {
    const updated = await updateSsbjReportBasicInfo(loaded.id, loaded.basicInfoRevision, formOf({ title: 'A の名称' }));
    expect(maybeSingle.mock.calls[0][0].filters).toEqual([['id', loaded.id], ['basicInfoRevision', 2]]);
    expect(updated).toMatchObject({ title: 'A の名称', basicInfoRevision: 3, draftRevision: 4 });
  });

  it('先に別の画面が保存していたら、古い画面の保存を競合として拒否し、先の変更を残す', async () => {
    await updateSsbjReportBasicInfo(loaded.id, loaded.basicInfoRevision, formOf({ purpose: 'A が直した目的' }));

    // 画面 B は再読込せずに別の項目を変えて保存する（フォームは全項目を送るので、目的は読込時の古い値のまま）。
    const stale = updateSsbjReportBasicInfo(loaded.id, loaded.basicInfoRevision, formOf({ industryCode: 'TR-RO' }));
    await expect(stale).rejects.toBeInstanceOf(SsbjEditConflictError);
    await expect(stale).rejects.toThrow(SSBJ_EDIT_CONFLICT_MESSAGE);
    expect(db.row).toMatchObject({ purpose: 'A が直した目的', industryCode: loaded.industryCode, basicInfoRevision: 3 });
  });

  it('基本情報と関係の無い変更（文章などで draftRevision だけが進んだ）では競合にしない', async () => {
    db.row = { ...db.row, draftRevision: 10 };
    await expect(
      updateSsbjReportBasicInfo(loaded.id, loaded.basicInfoRevision, formOf({ title: 'B の名称' })),
    ).resolves.toMatchObject({ title: 'B の名称', draftRevision: 11 });
  });

  it('競合後に最新の版数で保存し直すと保存できる', async () => {
    const first = await updateSsbjReportBasicInfo(loaded.id, loaded.basicInfoRevision, formOf({ title: 'A の名称' }));
    await expect(
      updateSsbjReportBasicInfo(loaded.id, loaded.basicInfoRevision, formOf({ title: 'B の名称' })),
    ).rejects.toBeInstanceOf(SsbjEditConflictError);
    await expect(
      updateSsbjReportBasicInfo(loaded.id, first.basicInfoRevision, formOf({ title: 'A の名称', industryCode: 'TR-RO' })),
    ).resolves.toMatchObject({ title: 'A の名称', industryCode: 'TR-RO' });
  });

  it('レポートが見えない（削除済み・他組織）ときは競合ではなく「見つかりません」にする', async () => {
    db.row = null;
    await expect(
      updateSsbjReportBasicInfo(loaded.id, loaded.basicInfoRevision, formOf({ title: 'A の名称' })),
    ).rejects.toThrow('SSBJレポートが見つかりません');
  });

  it('承認済みで DB が止めた（P2051）ときは承認済みの案内を返す', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { code: 'P2051', message: 'locked' } } as never);
    await expect(
      updateSsbjReportBasicInfo(loaded.id, loaded.basicInfoRevision, formOf({ title: 'A の名称' })),
    ).rejects.toThrow('承認済みのレポートは変更できません');
  });
});
