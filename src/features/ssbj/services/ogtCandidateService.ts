// OGT の確定集計と算定状況を、SSBJ の参照専用候補値へ変換する。
// 組織・年度は閲覧可能なレポートから受け取り、各問い合わせにも年度を指定する。

import type { SupabaseClient } from '@supabase/supabase-js';
import { scope3CategoryIdForEnergyType } from '@/features/calculation/engine/scope3Category';
import { scopeForEnergyTypeName } from '@/features/calculation/engine/energyTypeScope';
import { SCOPE3_CATEGORY_IDS } from '@/features/scope-analysis/services/scopeAnalysisService';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabaseRows';
import {
  OGT_EMISSION_UNIT,
  type OgtCalculationCoverage,
  type OgtCandidateValue,
  type OgtDataQuality,
  type OgtSupplierReference,
  type OgtValueSource,
  type SsbjReportRecord,
} from '../types';
import { isDecimalString } from '../utils/decimal';
import { checkOgtCandidateValue, deriveDirectInputDataQuality, deriveOgtDataQuality } from '../utils/ogtValue';

type NumericValues = {
  aggregate: { scope1: string; scope2: string; scope3: string; updatedAt: string } | null;
  scope2Breakdown: { basic: string; adjusted: string; unclassified: string } | null;
  categories: { categoryId: number; emissions: string }[];
  suppliers: { categoryId: number; supplierId: string; supplierName: string; emissions: string }[];
};

type ActivityCoverageRow = {
  energyType: string;
  calculatedCount: number | string;
  uncalculatedCount: number | string;
};
type Scope3CoverageRow = Pick<ActivityCoverageRow, 'calculatedCount' | 'uncalculatedCount'> & {
  categoryId: number | null;
  method: string;
};
type MethodRow = { categoryId: number; method: 'direct' | 'calculated' };
type DirectRow = { categoryId: number; updatedAt: string };
type BatchRow = { id: string; fiscalYearId: string; status: 'pending' | 'completed' | 'failed'; completedAt: string | null };

export type OgtCandidateData = { candidates: OgtCandidateValue[]; suppliers: OgtSupplierReference[] };

const count = (value: number | string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('算定件数の形式が正しくありません');
  return parsed;
};

const addCoverage = (target: OgtCalculationCoverage, row: Pick<ActivityCoverageRow, 'calculatedCount' | 'uncalculatedCount'>): void => {
  target.calculatedCount += count(row.calculatedCount);
  target.uncalculatedCount += count(row.uncalculatedCount);
};

const emptyCoverage = (): OgtCalculationCoverage => ({ calculatedCount: 0, uncalculatedCount: 0 });

const decimal = (value: unknown): string => {
  if (!isDecimalString(value)) throw new Error('OGT の排出量を正確に取得できませんでした');
  return value;
};

/** DB 応答を候補値に組み立てる。15カテゴリを常に出し、未入力を 0 にしない。 */
export const buildOgtCandidates = (input: {
  report: SsbjReportRecord;
  numeric: NumericValues;
  activityCoverage: ActivityCoverageRow[];
  scope3Coverage: Scope3CoverageRow[];
  methods: MethodRow[];
  directRows: DirectRow[];
  batches: BatchRow[];
}): OgtCandidateData => {
  const { report, numeric } = input;
  const latest = input.batches.find(batch => batch.fiscalYearId === report.fiscalYearId) ?? null;
  const latestBatch = latest ? { id: latest.id, status: latest.status, completedAt: latest.completedAt } : null;
  const aggregateSource: OgtValueSource = {
    kind: 'ogt', aggregate: 'dashboard_aggregates',
    aggregateUpdatedAt: numeric.aggregate?.updatedAt ?? null, latestBatch,
  };
  const common = {
    unit: OGT_EMISSION_UNIT,
    fiscalYearId: report.fiscalYearId,
    period: { startDate: report.periodStart, endDate: report.periodEnd },
    boundary: { kind: 'organization' } as const,
  } as const;
  const coverage1 = emptyCoverage();
  const coverage2 = emptyCoverage();
  const scope3Coverage = new Map<number, OgtCalculationCoverage>();
  for (const id of SCOPE3_CATEGORY_IDS) scope3Coverage.set(id, emptyCoverage());

  for (const row of input.activityCoverage) {
    const scope = scopeForEnergyTypeName(row.energyType);
    if (scope === 'scope1') addCoverage(coverage1, row);
    if (scope === 'scope2') addCoverage(coverage2, row);
    if (scope === 'scope3' && row.energyType !== 'scope3_activity') {
      const categoryId = scope3CategoryIdForEnergyType(row.energyType as Parameters<typeof scope3CategoryIdForEnergyType>[0]);
      if (categoryId === null) throw new Error('Scope 3 のカテゴリを判定できませんでした');
      addCoverage(scope3Coverage.get(categoryId)!, row);
    }
  }
  for (const row of input.scope3Coverage) {
    if (row.categoryId !== null && scope3Coverage.has(row.categoryId)) {
      addCoverage(scope3Coverage.get(row.categoryId)!, row);
    }
  }

  const activityValue = (quality: OgtDataQuality, value: string) =>
    quality === 'not_calculated' ? { state: 'unanswered' as const } : { state: 'answered' as const, value: decimal(value) };
  const scope1Quality = deriveOgtDataQuality({ hasAggregate: !!numeric.aggregate, coverage: coverage1 });
  const scope2Quality = deriveOgtDataQuality({ hasAggregate: !!numeric.aggregate, coverage: coverage2 });
  const candidates: OgtCandidateValue[] = [
    { ...common, scope: 1, scope3CategoryId: null, method: { kind: 'activity_based' },
      value: activityValue(scope1Quality, numeric.aggregate?.scope1 ?? '0'), dataQuality: scope1Quality,
      coverage: coverage1, source: aggregateSource },
    { ...common, scope: 2, scope3CategoryId: null,
      method: { kind: 'activity_based', scope2Basis: 'unknown', factorTypeBreakdown: numeric.scope2Breakdown },
      value: activityValue(scope2Quality, numeric.aggregate?.scope2 ?? '0'), dataQuality: scope2Quality,
      coverage: coverage2, source: aggregateSource },
  ];

  const methodByCategory = new Map(input.methods.map(row => [row.categoryId, row.method]));
  const directByCategory = new Map(input.directRows.map(row => [row.categoryId, row]));
  const valueByCategory = new Map(numeric.categories.map(row => [row.categoryId, row.emissions]));
  for (const categoryId of SCOPE3_CATEGORY_IDS) {
    const method = methodByCategory.get(categoryId) ?? 'direct';
    const coverage = scope3Coverage.get(categoryId)!;
    const direct = directByCategory.get(categoryId);
    const quality = method === 'direct'
      ? deriveDirectInputDataQuality(!!direct)
      : deriveOgtDataQuality({ hasAggregate: !!numeric.aggregate, coverage });
    const source: OgtValueSource = method === 'direct' && direct
      ? { ...aggregateSource, aggregate: 'scope3_category_emissions', aggregateUpdatedAt: direct.updatedAt }
      : { ...aggregateSource, aggregate: 'dashboard_scope3_category_emissions' };
    candidates.push({ ...common, scope: 3, scope3CategoryId: categoryId, method: { kind: method },
      value: activityValue(quality, valueByCategory.get(categoryId) ?? '0'), dataQuality: quality,
      coverage: method === 'direct' ? null : coverage, source });
  }

  const categories = candidates.filter(candidate => candidate.scope === 3 && candidate.scope3CategoryId !== null);
  const answeredCount = categories.filter(candidate => candidate.dataQuality !== 'not_calculated').length;
  const totalQuality: OgtDataQuality = !numeric.aggregate || answeredCount === 0 ? 'not_calculated'
    : categories.every(candidate => candidate.dataQuality === 'all_calculated') ? 'all_calculated' : 'partially_calculated';
  const calculatedCategories = categories.filter(candidate => candidate.method.kind === 'calculated');
  const totalCoverage = calculatedCategories.length === 0 ? null : calculatedCategories.reduce((sum, candidate) => ({
    calculatedCount: sum.calculatedCount + (candidate.coverage?.calculatedCount ?? 0),
    uncalculatedCount: sum.uncalculatedCount + (candidate.coverage?.uncalculatedCount ?? 0),
  }), emptyCoverage());
  candidates.splice(2, 0, { ...common, scope: 3, scope3CategoryId: null, method: { kind: 'per_category' },
    value: activityValue(totalQuality, numeric.aggregate?.scope3 ?? '0'), dataQuality: totalQuality,
    coverage: totalCoverage, source: aggregateSource });

  for (const candidate of candidates) {
    if (checkOgtCandidateValue(candidate).length) throw new Error('OGT 候補値の形式が正しくありません');
  }
  const suppliers: OgtSupplierReference[] = numeric.suppliers.map(row => ({
    kind: 'supplier_reference', fiscalYearId: report.fiscalYearId, scope3CategoryId: row.categoryId,
    supplierId: row.supplierId, supplierName: row.supplierName,
    emissions: decimal(row.emissions), unit: OGT_EMISSION_UNIT,
  }));
  return { candidates, suppliers };
};

/** RLS を適用したブラウザクライアントから、レポート年度の候補値を取得する。 */
export const getOgtCandidates = async (report: SsbjReportRecord): Promise<OgtCandidateData> =>
  fetchOgtCandidates(createClient(), report);

/**
 * getOgtCandidates の本体。採用（T08b）ではサーバがセッションを引き継いだクライアントで同じ処理を呼び、
 * 画面に表示したものと同じ組み立てで候補値を取り直す（クライアントから値を受け取らないため）。
 */
export const fetchOgtCandidates = async (
  supabase: SupabaseClient,
  report: SsbjReportRecord,
): Promise<OgtCandidateData> => {
  const yearId = report.fiscalYearId;
  const [numeric, activityCoverage, scope3Coverage, methods, directRows, batches] = await Promise.all([
    supabase.rpc('ssbj_ogt_numeric_values', { p_fiscal_year_id: yearId }),
    fetchAllRows<ActivityCoverageRow>((from, to) => supabase.rpc('report_activity_calculation_coverage', {
      p_start_date: report.periodStart, p_end_date: report.periodEnd,
    }).range(from, to), '算定件数の取得に失敗しました'),
    supabase.rpc('report_scope3_activity_calculation_coverage', { p_fiscal_year_id: yearId }),
    supabase.from('scope3_category_methods').select('categoryId, method').eq('fiscalYearId', yearId),
    supabase.from('scope3_category_emissions').select('categoryId, updatedAt').eq('fiscalYearId', yearId),
    supabase.rpc('report_latest_calculation_batches'),
  ]);
  if (numeric.error || !numeric.data || scope3Coverage.error || methods.error || directRows.error || batches.error) {
    throw new Error('OGT 候補値の取得に失敗しました');
  }
  return buildOgtCandidates({ report, numeric: numeric.data as NumericValues, activityCoverage,
    scope3Coverage: (scope3Coverage.data ?? []) as Scope3CoverageRow[],
    methods: (methods.data ?? []) as MethodRow[], directRows: (directRows.data ?? []) as DirectRow[],
    batches: (batches.data ?? []) as BatchRow[] });
};
