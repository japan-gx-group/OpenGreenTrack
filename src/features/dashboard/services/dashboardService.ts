import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import {
  getFiscalYearStartMonthFromDate,
  getPreviousFiscalYearPeriod,
} from '@/lib/fiscal-year/fiscalYearPeriod';
import { resolveFiscalYearCandidates, type FiscalYearLookupRow } from '@/lib/fiscal-year/fiscalYearLookup';
import {
  buildDashboardMonthlyData,
  buildDashboardSummary,
  buildLocationDashboardData,
  buildLocationYearlyEmissionData,
  buildScope3PieData,
  buildTopLocationDetails,
  buildYearlyEmissionData,
  sumFallbackFiscalYearTotal,
  type DashboardMonthlyPoint,
  type DashboardScope3Item,
  type DashboardSummaryItem,
  type DashboardTopLocationDetail,
  type DashboardYearlyPoint,
  type FiscalYearAggregateRow,
  type FiscalYearBucket,
  type LocationDashboardData,
  type LocationScopeEmissionRow,
  type MonthlyEmissionRow,
  type Scope3CategoryEmissionRow,
} from './dashboardAggregation';

export type {
  DashboardMonthlyPoint,
  DashboardScope3Item,
  DashboardSummaryItem,
  DashboardTopLocationDetail,
  DashboardYearlyPoint,
  FiscalYearBucket,
  LocationDashboardData,
} from './dashboardAggregation';

type FiscalYearRow = FiscalYearLookupRow;

type DashboardAggregateRow = FiscalYearAggregateRow;

export type DashboardData = {
  fiscalYear: FiscalYearRow;
  summary: DashboardSummaryItem[];
  monthlyData: DashboardMonthlyPoint[];
  scope3PieData: DashboardScope3Item[];
  /** 上位拠点テーブル用（Scope 内訳・地域/種別・前年比つき） */
  topLocationDetails: DashboardTopLocationDetail[];
};

const getDashboardAggregate = async (
  supabase: SupabaseClient,
  fiscalYearIds: string[],
): Promise<DashboardAggregateRow | null> => {
  if (fiscalYearIds.length === 0) return null;

  // 候補には同じ期間を持つ別の年度行も含まれる（fiscalYearLookup 参照）。
  // dashboard_aggregates は RLS で自組織の行だけ返るため、候補年度IDから集計行を特定する。
  const { data, error } = await supabase
    .from('dashboard_aggregates')
    .select('fiscalYearId, scope1Total, scope2Total, scope3Total')
    .in('fiscalYearId', fiscalYearIds);

  if (error) {
    throw new Error('ダッシュボード集計の取得に失敗しました');
  }

  const rows = (data ?? []) as DashboardAggregateRow[];
  return fiscalYearIds
    .map(fiscalYearId => rows.find(row => row.fiscalYearId === fiscalYearId))
    .find((row): row is DashboardAggregateRow => Boolean(row)) ?? null;
};

// dashboard_aggregates 行が無い場合に、実データが紐づいている会計年度行を候補から特定する。
// 同じ期間の年度行が重複登録されていると candidates[0] がデータの無い方を指し、
// scope3_category_emissions が0件になってグラフが空表示になり得るため。
//
// 注: fiscal_years の RLS は自組織の行しか返すため、必要になるのは同一組織内で年度が重複した
// ときだけ。重複年度を許さない方針にすれば、この関数（1呼び出しあたり2クエリ）ごと削除できる。
const findOrgFiscalYear = async (
  supabase: SupabaseClient,
  candidates: FiscalYearRow[],
): Promise<FiscalYearRow | null> => {
  const candidateIds = candidates.map(candidate => candidate.id);
  if (candidateIds.length === 0) return null;

  const orgScopedTables = ['dashboard_aggregates', 'scope3_category_emissions'] as const;
  const presentIds = new Set<string>();

  for (const table of orgScopedTables) {
    const { data, error } = await supabase
      .from(table)
      .select('fiscalYearId')
      .in('fiscalYearId', candidateIds);
    if (error) continue;
    ((data ?? []) as { fiscalYearId: string }[]).forEach(row => presentIds.add(row.fiscalYearId));
  }

  // candidates は createdAt 昇順で並ぶ。実データが存在する最優先候補を返す。
  return candidates.find(candidate => presentIds.has(candidate.id)) ?? null;
};

// 月別×Scope の排出量集計（DB側RPC）。period は年度行（fiscal_years）または同じ形の期間。
// 期間内の活動量由来 emission_results を DB 側で月初日×Scope に集約して受け取るため、
// 返る行数は最大 12ヶ月×3Scope = 36行（全行取得はしない）。
// locationId を渡すと当該拠点の活動量レコードのみを集計する（拠点絞り込みダッシュボード用）。
// NOTE: activityRecordId が NULL の行（活動量に紐づかない Scope 3 集計結果など）は、
// 期間（＝年度）を特定する術が無いためこの集計の対象から外れる。
// それらの Scope 3 集計は scope3_category_emissions / dashboard_aggregates 側で表示している。
// RLS は security invoker の関数内でそのまま効く
// （supabase/migrations/20260831000002_rpc.sql の dashboard_monthly_emissions 参照）。
const getMonthlyEmissions = async (
  supabase: SupabaseClient,
  period: Pick<FiscalYearRow, 'startDate' | 'endDate'>,
  locationId?: string,
): Promise<MonthlyEmissionRow[]> => {
  const { data, error } = await supabase.rpc('dashboard_monthly_emissions', {
    p_start_date: period.startDate,
    p_end_date: period.endDate,
    p_location_id: locationId ?? null,
  });

  if (error) {
    throw new Error('排出量データの取得に失敗しました');
  }

  return (data ?? []) as MonthlyEmissionRow[];
};

// 拠点 × Scope（1/2）別の排出量集計。上位拠点テーブルの Scope 内訳・地域/種別・前年比に使う。
// 前年比は呼び出し側が前年度期間で同じ関数をもう一度呼んで算出する。
const getLocationScopeEmissions = async (
  supabase: SupabaseClient,
  period: Pick<FiscalYearRow, 'startDate' | 'endDate'>,
): Promise<LocationScopeEmissionRow[]> => {
  const { data, error } = await supabase.rpc('dashboard_location_emissions_by_scope', {
    p_start_date: period.startDate,
    p_end_date: period.endDate,
  });

  if (error) {
    throw new Error('拠点別排出量の取得に失敗しました');
  }

  return (data ?? []) as LocationScopeEmissionRow[];
};

// Scope 3 カテゴリ別の「採用値」（scope3_category_methods の方式適用後）を DB 側で集計して取得する。
// で方式切替が入ってから、scope3_category_emissions を直読みすると calculated へ
// 切り替えたカテゴリで採用されない直接入力値を拾ってしまい、内訳バーの合計が見出しの
// 「計」（dashboard_aggregates.scope3Total）と食い違う。RPC は scope3Total を導くのと
// 同一の式（refresh_dashboard_aggregates §5.1）で返すため、合計は定義上一致する。
const getScope3CategoryEmissions = async (
  supabase: SupabaseClient,
  fiscalYearId: string,
): Promise<Scope3CategoryEmissionRow[]> => {
  const { data, error } = await supabase.rpc('dashboard_scope3_category_emissions', {
    p_fiscal_year_id: fiscalYearId,
  });

  if (error) {
    throw new Error('Scope 3カテゴリ別排出量の取得に失敗しました');
  }

  return (data ?? []) as Scope3CategoryEmissionRow[];
};

/**
 * dashboard_aggregates 行がまだ無い年度の総排出量（Scope 1〜3）。削減目標カードの
 * 年間実績・基準年度実績のフォールバックに使う（targetService 参照）。
 * Scope 1/2 は月別 RPC、Scope 3 はカテゴリ別採用値 RPC から取り、合計の定義を
 * dashboard_aggregates と揃える（sumFallbackFiscalYearTotal のコメント参照）。
 */
export const getFallbackFiscalYearTotal = async (
  supabase: SupabaseClient,
  fiscalYearId: string,
  period: Pick<FiscalYearRow, 'startDate' | 'endDate'>,
): Promise<number> => {
  const [monthlyRows, scope3Rows] = await Promise.all([
    getMonthlyEmissions(supabase, period),
    getScope3CategoryEmissions(supabase, fiscalYearId),
  ]);
  return sumFallbackFiscalYearTotal(monthlyRows, scope3Rows);
};

export const getDashboardData = async (
  fiscalYear: string,
  fiscalYearId?: string | null,
): Promise<DashboardData> => {
  const supabase = createClient();
  const [currentFiscalYearCandidates, previousFiscalYearCandidates] = await Promise.all([
    resolveFiscalYearCandidates(supabase, fiscalYear, fiscalYearId),
    resolveFiscalYearCandidates(supabase, String(Number(fiscalYear) - 1)).catch(() => []),
  ]);
  const currentFiscalYearIds = currentFiscalYearCandidates.map(candidate => candidate.id);
  const previousFiscalYearIds = previousFiscalYearCandidates.map(candidate => candidate.id);

  const [
    currentAggregate,
    previousAggregate,
  ] = await Promise.all([
    getDashboardAggregate(supabase, currentFiscalYearIds),
    getDashboardAggregate(supabase, previousFiscalYearIds),
  ]);

  const currentFiscalYear =
    currentFiscalYearCandidates.find(candidate => candidate.id === currentAggregate?.fiscalYearId) ??
    (await findOrgFiscalYear(supabase, currentFiscalYearCandidates)) ??
    currentFiscalYearCandidates[0];
  const currentFiscalYearId = currentFiscalYear.id;

  const previousFiscalYear =
    previousFiscalYearCandidates.find(candidate => candidate.id === previousAggregate?.fiscalYearId) ??
    (await findOrgFiscalYear(supabase, previousFiscalYearCandidates)) ??
    null;
  // 前年度行がまだ登録されていない場合でも、当年度と同じ期首月から前年度期間を導出する。
  const previousPeriod = previousFiscalYear ?? getPreviousFiscalYearPeriod(currentFiscalYear);
  const fiscalYearStartMonth = getFiscalYearStartMonthFromDate(currentFiscalYear.startDate);

  const [
    currentMonthlyRows,
    previousMonthlyRows,
    scope3CategoryEmissions,
    previousScope3CategoryEmissions,
    currentLocationScopeRows,
    previousLocationScopeRows,
  ] = await Promise.all([
    getMonthlyEmissions(supabase, currentFiscalYear),
    getMonthlyEmissions(supabase, previousPeriod),
    getScope3CategoryEmissions(supabase, currentFiscalYearId),
    // KPI の Scope 3 前年比も当年度と同じ採用値の定義で出す（buildDashboardSummary 参照）。
    // 前年度行が未登録なら Scope 3 は組織・年度単位でしか持てないため 0 件扱い。
    previousFiscalYear ? getScope3CategoryEmissions(supabase, previousFiscalYear.id) : Promise.resolve([]),
    getLocationScopeEmissions(supabase, currentFiscalYear),
    getLocationScopeEmissions(supabase, previousPeriod),
  ]);

  return {
    fiscalYear: currentFiscalYear,
    summary: buildDashboardSummary(
      currentAggregate,
      previousAggregate,
      scope3CategoryEmissions,
      previousScope3CategoryEmissions,
    ),
    monthlyData: buildDashboardMonthlyData(currentMonthlyRows, previousMonthlyRows, fiscalYearStartMonth),
    scope3PieData: buildScope3PieData(scope3CategoryEmissions),
    topLocationDetails: buildTopLocationDetails(currentLocationScopeRows, previousLocationScopeRows),
  };
};

export type DashboardLocationOption = {
  id: string;
  name: string;
};

// 拠点絞り込みドロップダウン用の拠点一覧（id + 名称）。RLS により自組織の拠点のみ返る。
// locationService.getLocations は画面表示用 LocationRecord（フル項目）を返すため、
// 絞り込みに必要な id + 名称 だけの軽量な一覧はここで取得する。並び順は拠点管理画面と同じ。
export const getDashboardLocationOptions = async (): Promise<DashboardLocationOption[]> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('locations')
    .select('id, name')
    .order('createdAt', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    throw new Error('拠点一覧の取得に失敗しました');
  }

  return ((data ?? []) as DashboardLocationOption[]).map(row => ({ id: row.id, name: row.name }));
};

// 拠点絞り込み時のダッシュボードデータ（Scope 1/2 のみ）。
// Scope 3 は組織・年度単位でしか持てないため、このデータには含めない
// （表示側で組織全体値＋注記に切り替える）。前年比は前年度の同拠点の月別集計から算出する。
export const getLocationDashboardData = async (
  fiscalYear: string,
  locationId: string,
  fiscalYearId?: string | null,
): Promise<LocationDashboardData> => {
  const supabase = createClient();
  const [currentFiscalYearCandidates, previousFiscalYearCandidates] = await Promise.all([
    resolveFiscalYearCandidates(supabase, fiscalYear, fiscalYearId),
    resolveFiscalYearCandidates(supabase, String(Number(fiscalYear) - 1)).catch(() => []),
  ]);
  const currentPeriod =
    (await findOrgFiscalYear(supabase, currentFiscalYearCandidates)) ??
    currentFiscalYearCandidates[0];
  const previousPeriod =
    (await findOrgFiscalYear(supabase, previousFiscalYearCandidates)) ??
    previousFiscalYearCandidates[0] ??
    getPreviousFiscalYearPeriod(currentPeriod);
  const fiscalYearStartMonth = getFiscalYearStartMonthFromDate(currentPeriod.startDate);

  const [currentRows, previousRows] = await Promise.all([
    getMonthlyEmissions(supabase, currentPeriod, locationId),
    getMonthlyEmissions(supabase, previousPeriod, locationId),
  ]);

  return buildLocationDashboardData(currentRows, previousRows, { fiscalYearStartMonth });
};

// 年度別推移グラフ（月別グラフの「年度」表示）の系列。fiscalYears には FiscalYearContext の
// 年度一覧（自組織のみ）を渡す。並び順・0埋めは純粋関数側で行う。
//
// 全拠点: dashboard_aggregates を1クエリで引く（KPI カードと同じ権威値。Scope 3 の年次集計を含む）。
// 拠点絞り込み: 拠点別に持てるのは活動量由来の Scope 1/2 だけなので、全年度をまたぐ1回の
// dashboard_monthly_emissions（年度数 × 12ヶ月 × 2〜3 Scope 行）で取り、年度期間へ振り分ける。
// 年度ごとに RPC を呼ぶとクエリ数が年度数に比例するため、期間をまとめて1回にしている。
export const getYearlyEmissions = async (
  fiscalYears: FiscalYearBucket[],
  locationId?: string | null,
): Promise<DashboardYearlyPoint[]> => {
  if (fiscalYears.length === 0) return [];

  const supabase = createClient();

  if (!locationId) {
    const { data, error } = await supabase
      .from('dashboard_aggregates')
      .select('fiscalYearId, scope1Total, scope2Total, scope3Total')
      .in('fiscalYearId', fiscalYears.map(fiscalYear => fiscalYear.id));

    if (error) {
      throw new Error('年度別排出量の取得に失敗しました');
    }

    return buildYearlyEmissionData(fiscalYears, (data ?? []) as FiscalYearAggregateRow[]);
  }

  const startDate = fiscalYears.reduce(
    (earliest, fiscalYear) => (fiscalYear.startDate < earliest ? fiscalYear.startDate : earliest),
    fiscalYears[0].startDate,
  );
  const endDate = fiscalYears.reduce(
    (latest, fiscalYear) => (fiscalYear.endDate > latest ? fiscalYear.endDate : latest),
    fiscalYears[0].endDate,
  );
  const rows = await getMonthlyEmissions(supabase, { startDate, endDate }, locationId);

  return buildLocationYearlyEmissionData(fiscalYears, rows);
};
