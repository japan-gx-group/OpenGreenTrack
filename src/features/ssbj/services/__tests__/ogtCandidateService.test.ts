import { describe, expect, it } from 'vitest';
import { fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';
import type { SsbjReportRecord } from '../../types';
import { buildOgtCandidates } from '../ogtCandidateService';

const report: SsbjReportRecord = {
  ...fictionalReportBasicInfo,
  fiscalYearLabel: '2024年度', periodStart: '2024-04-01', periodEnd: '2025-03-31',
};

const input = () => ({
  report,
  numeric: {
    aggregate: { scope1: '12.000', scope2: '4.000', scope3: '7.000', updatedAt: '2025-04-01T00:00:00Z' },
    scope2Breakdown: { basic: '1.000', adjusted: '3.000', unclassified: '0' },
    // 値 0 の直接入力は既存 RPC から返らない。カテゴリ 6 の 7 は積上げの採用値。
    categories: [{ categoryId: 6, emissions: '7.000' }],
    suppliers: [{ categoryId: 6, supplierId: 'supplier-1', supplierName: '供給元', emissions: '99.000' }],
  },
  activityCoverage: [
    { energyType: 'fuel', calculatedCount: 1, uncalculatedCount: 0 },
    { energyType: 'electricity', calculatedCount: 1, uncalculatedCount: 1 },
    { energyType: 'business_travel', calculatedCount: 1, uncalculatedCount: 1 },
  ],
  scope3Coverage: [{ energyType: 'scope3_activity', categoryId: 6, method: 'calculated', calculatedCount: 1, uncalculatedCount: 0 }],
  methods: [{ categoryId: 6, method: 'calculated' as const }],
  directRows: [{ categoryId: 1, updatedAt: '2025-04-01T00:00:00Z' },
    { categoryId: 6, updatedAt: '2025-04-01T00:00:00Z' }],
  batches: [{ id: 'batch-1', fiscalYearId: report.fiscalYearId, status: 'failed' as const, completedAt: null }],
});

describe('buildOgtCandidates', () => {
  it('0 と未算定を分け、Scope 3 の採用方式・標準係数の件数・参考値を保持する', () => {
    const { candidates, suppliers } = buildOgtCandidates(input());
    expect(candidates).toHaveLength(18);
    expect(candidates[1]).toMatchObject({ scope: 2, dataQuality: 'partially_calculated',
      method: { scope2Basis: 'unknown', factorTypeBreakdown: { adjusted: '3.000' } },
      source: { latestBatch: { status: 'failed' } } });
    expect(candidates[2]).toMatchObject({ scope: 3, scope3CategoryId: null,
      value: { state: 'answered', value: '7.000' }, dataQuality: 'partially_calculated' });
    expect(candidates[3]).toMatchObject({ scope3CategoryId: 1, method: { kind: 'direct' },
      value: { state: 'answered', value: '0' }, dataQuality: 'all_calculated' });
    expect(candidates[4]).toMatchObject({ scope3CategoryId: 2, value: { state: 'unanswered' },
      dataQuality: 'not_calculated' });
    expect(candidates[8]).toMatchObject({ scope3CategoryId: 6, method: { kind: 'calculated' },
      value: { state: 'answered', value: '7.000' }, coverage: { calculatedCount: 2, uncalculatedCount: 1 },
      dataQuality: 'partially_calculated' });
    expect(suppliers).toEqual([{ kind: 'supplier_reference', fiscalYearId: report.fiscalYearId,
      scope3CategoryId: 6, supplierId: 'supplier-1', supplierName: '供給元',
      emissions: '99.000', unit: 't-CO2e' }]);
  });

  it('集計行も算定済み活動量も無ければ合計を 0 とせず未算定にする', () => {
    const empty = { ...input(), numeric: { ...input().numeric, aggregate: null },
      activityCoverage: [], scope3Coverage: [], directRows: [] };
    const { candidates } = buildOgtCandidates(empty);
    expect(candidates[0].value).toEqual({ state: 'unanswered' });
    expect(candidates[1].value).toEqual({ state: 'unanswered' });
    expect(candidates[2].value).toEqual({ state: 'unanswered' });
  });
});

describe('buildOgtCandidates（二重加算の防止）', () => {
  it('サプライヤー別の値（参考値）を Scope 3 の合計にもカテゴリの値にも足さない', () => {
    const { candidates, suppliers } = buildOgtCandidates(input());
    const scope3Total = candidates.find(candidate => candidate.scope === 3 && candidate.scope3CategoryId === null);
    const category6 = candidates.find(candidate => candidate.scope3CategoryId === 6);
    expect(suppliers.map(supplier => supplier.emissions)).toEqual(['99.000']);
    expect(scope3Total?.value).toEqual({ state: 'answered', value: '7.000' });
    expect(category6?.value).toEqual({ state: 'answered', value: '7.000' });
  });

  it('区分ごとに候補値は 1 つだけ（Scope 1・2・3 合計と 15 カテゴリ）', () => {
    const { candidates } = buildOgtCandidates(input());
    const keys = candidates.map(candidate => `${candidate.scope}:${candidate.scope3CategoryId ?? 'total'}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(18);
  });
});
