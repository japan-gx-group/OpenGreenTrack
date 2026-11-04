import { afterEach, describe, expect, it, vi } from 'vitest';
import { FICTIONAL_FISCAL_YEAR, fictionalTnfdReportBasicInfo } from '../../__fixtures__/fictionalReport';
import { getTnfdReport, toTnfdReportRecord, type TnfdReportRow } from '../reportService';

// Supabase への問い合わせは「取得結果 → 画面の型」への変換と、ID 不正時の扱いだけを検証する。
const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));

const row = (fiscalYears: TnfdReportRow['fiscal_years']): TnfdReportRow => ({
  id: fictionalTnfdReportBasicInfo.id,
  organizationId: fictionalTnfdReportBasicInfo.organizationId,
  fiscalYearId: fictionalTnfdReportBasicInfo.fiscalYearId,
  title: fictionalTnfdReportBasicInfo.title,
  purpose: fictionalTnfdReportBasicInfo.purpose,
  reportingScope: fictionalTnfdReportBasicInfo.reportingScope,
  standardVersion: null,
  createdAt: fictionalTnfdReportBasicInfo.createdAt,
  updatedAt: fictionalTnfdReportBasicInfo.updatedAt,
  fiscal_years: fiscalYears,
});

const EMBED = {
  label: FICTIONAL_FISCAL_YEAR.label,
  startDate: FICTIONAL_FISCAL_YEAR.startDate,
  endDate: FICTIONAL_FISCAL_YEAR.endDate,
};

afterEach(() => {
  maybeSingle.mockReset();
});

describe('toTnfdReportRecord', () => {
  it('埋め込んだ年度のラベル・期間を添え、未入力の任意項目は null のまま返す', () => {
    expect(toTnfdReportRecord(row(EMBED))).toEqual({
      ...fictionalTnfdReportBasicInfo,
      standardVersion: null,
      fiscalYearLabel: '2024年度',
      periodStart: '2024-04-01',
      periodEnd: '2025-03-31',
    });
  });

  it('年度の埋め込みが配列で返っても同じ結果になる', () => {
    expect(toTnfdReportRecord(row([EMBED]))).toEqual(toTnfdReportRecord(row(EMBED)));
  });

  it('年度が取れない行は例外にする', () => {
    expect(() => toTnfdReportRecord(row(null))).toThrow('算定年度を取得できませんでした');
  });
});

describe('getTnfdReport', () => {
  it('該当なし（存在しない・他組織で RLS により不可視）は null', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getTnfdReport('7c2e0000-0000-4000-8000-0000000000ff')).resolves.toBeNull();
  });

  it('UUID 形式でない ID（22P02）は通信エラーにせず null', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: '22P02', message: 'invalid input syntax' } });
    await expect(getTnfdReport('not-a-uuid')).resolves.toBeNull();
  });

  it('それ以外のエラーは例外にする', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    await expect(getTnfdReport(fictionalTnfdReportBasicInfo.id)).rejects.toThrow('TNFDレポートの取得に失敗しました');
  });

  it('取得できた行は TnfdReportRecord に変換する', async () => {
    maybeSingle.mockResolvedValue({ data: row(EMBED), error: null });
    await expect(getTnfdReport(fictionalTnfdReportBasicInfo.id)).resolves.toMatchObject({
      id: fictionalTnfdReportBasicInfo.id,
      fiscalYearLabel: '2024年度',
    });
  });
});
