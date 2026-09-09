import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabaseRows';
import {
  getLocationTypeLabel,
  getRegionLabel,
  type LocationType,
  type Region,
} from '@/features/locations/types';
// types.ts は本ファイルから ReportTypeId を型のみ import しているため、実行時の循環参照にはならない。
import { ORGANIZATION_WIDE_TARGET_LABEL, usesLocationFilter } from '../types';

export type ReportTypeId = 'annual_summary' | 'scope3_detail' | 'location_breakdown';
// 実生成できるのは CSV（クライアント生成）と 印刷用PDFビュー（window.print）。
// 表計算向けは新ライブラリ無しで xlsx を作れないため CSV（Excel で開ける）に統一する。
export type ReportFormat = 'pdf' | 'csv';

export type ReportFiscalYear = {
  id: string;
  year: string;
  label: string;
  startDate: string;
  endDate: string;
};

export type ReportLocation = {
  id: string;
  name: string;
  region: Region;
  regionLabel: string;
  type: LocationType;
  typeLabel: string;
};

export type ReportTargetSummary = {
  fiscalYearId: string;
  fiscalYear: string;
  fiscalYearLabel: string;
  scope1Total: number;
  scope2Total: number;
  scope3Total: number;
  totalEmissions: number;
  scope3CategoryCount: number;
  latestAggregateUpdatedAt?: string;
  latestBatchStatus?: string;
  latestBatchCompletedAt?: string;
};

/**
 * 拠点 × Scope で集約済みの算定結果1行（report_location_scope_emissions RPC 由来）。
 * 常に単一年度分（取得時に指定した fiscalYearId）のみが返る。
 * 年度帰属は活動量の periodStart 基準で、年次サマリ（dashboard_aggregates）・
 * データ充足状況と同基準（算定バッチの年度では絞らない）。
 * 1件の emission_results 行ではなく集計行のため、件数表示には recordCount を使うこと。
 */
export type ReportEmissionResult = {
  fiscalYearId: string;
  locationId: string;
  scope: 'scope1' | 'scope2' | 'scope3';
  emissions: number;
  /** この集計行に畳み込まれた emission_results の行数（画面の「算定済みレコード件数」用）。 */
  recordCount: number;
};

export type ReportHistoryItem = {
  id: string;
  name: string;
  type: string;
  fiscalYear: string;
  format: 'PDF' | 'CSV';
  targetSummary: string;
  generatedAt: string;
  // 履歴からの再ダウンロード（CSVは条件から再生成、PDFは印刷ビュー再表示）に使う生成条件。
  reportType?: ReportTypeId;
  fiscalYearId?: string;
  locationIds: string[];
};

export type ReportData = {
  fiscalYears: ReportFiscalYear[];
  locations: ReportLocation[];
  summaries: ReportTargetSummary[];
  emissionResults: ReportEmissionResult[];
  histories: ReportHistoryItem[];
};

/**
 * 年度を切り替えても変わらない画面データ。emissionResults だけが年度スコープのため、
 * 画面側は本データを初回に1度だけ読み、算定結果は年度切替のたびに読み直す。
 */
export type ReportBaseData = Omit<ReportData, 'emissionResults'>;

export type CreateReportHistoryInput = {
  reportType: ReportTypeId;
  reportTypeLabel: string;
  fiscalYearId: string;
  fiscalYear: string;
  fiscalYearLabel: string;
  format: ReportFormat;
  locationIds: string[];
  scope1Total: number;
  scope2Total: number;
  scope3Total: number;
  totalEmissions: number;
};

type ProfileRow = {
  organizationId: string;
};

type FiscalYearRow = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

type LocationRow = {
  id: string;
  name: string;
  region: Region;
  type: LocationType;
};

type DashboardAggregateRow = {
  fiscalYearId: string;
  scope1Total: number | string;
  scope2Total: number | string;
  scope3Total: number | string;
  updatedAt: string | null;
};

type Scope3CategoryEmissionRow = {
  fiscalYearId: string;
};

type CalculationBatchRow = {
  id: string;
  fiscalYearId: string;
  status: string;
  processedCount: number;
  completedAt: string | null;
  startedAt: string;
};

/** report_location_scope_emissions RPC の1行（年度 × 拠点 × Scope の集計）。 */
type LocationScopeEmissionRow = {
  fiscalYearId: string;
  locationId: string;
  scope: 'scope1' | 'scope2' | 'scope3';
  /** 排出量合計。supabase-js からは numeric が string で返ることがある */
  emissions: number | string;
  /** 集約前の emission_results 行数。bigint のため string で返ることがある */
  recordCount: number | string;
};

type AuditLogRow = {
  id: string;
  detail: string | null;
  createdAt: string;
};

type ReportAuditDetail = {
  reportType?: ReportTypeId;
  fiscalYearId?: string;
  fiscalYearValue?: string;
  name?: string;
  type?: string;
  fiscalYear?: string;
  format?: 'PDF' | 'CSV';
  locationIds?: string[];
  locationCount?: number;
  scope1Total?: number;
  scope2Total?: number;
  scope3Total?: number;
  totalEmissions?: number;
};

const REPORT_AUDIT_ACTION = 'reports.generate';
const REPORT_AUDIT_ENTITY = 'reports';

const toNumber = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const extractYear = (row: FiscalYearRow): string => {
  const labelYear = row.label.match(/\d{4}/)?.[0];
  if (labelYear) return labelYear;
  return row.startDate.slice(0, 4);
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

const formatEmissionValue = (value?: number): string | null => {
  if (value === undefined || !Number.isFinite(value)) return null;
  return `${value.toLocaleString('ja-JP', { maximumFractionDigits: 3 })} t-CO2e`;
};

const safeParseDetail = (detail: string | null): ReportAuditDetail => {
  if (!detail) return {};
  try {
    return JSON.parse(detail) as ReportAuditDetail;
  } catch {
    return {};
  }
};

// 拠点別 Scope 集計は DB 側（report_location_scope_emissions RPC）で行う。
// emission_results を全行ブラウザへ取得する方式をやめ、拠点 × Scope に集約済みの
// 行だけを受け取る（返る行数は活動量レコード数に比例しない）。
// 画面が表示するのは常に選択中の1年度分だけのため、年度も RPC 側で絞る。
// 集約後も 拠点数 × 3Scope が PostgREST の max_rows（1000）を超え得るため、
// RPC 側の安定ソート（拠点→Scope）に合わせて range() でページングする。
const fetchLocationScopeEmissions = async (
  supabase: SupabaseClient,
  fiscalYearId: string,
): Promise<LocationScopeEmissionRow[]> =>
  fetchAllRows<LocationScopeEmissionRow>(
    (from, to) =>
      supabase
        .rpc('report_location_scope_emissions', { p_fiscal_year_id: fiscalYearId })
        .range(from, to),
    '拠点別算定結果の取得に失敗しました',
  );

// 年度ごとの最新算定バッチ。calculation_batches を無条件 select すると PostgREST の
// max_rows（1000）で黙って切り詰められ、バッチが多い組織で古い年度の算定状況・処理件数が
// 欠落するため、DB 側（report_latest_calculation_batches RPC）で1年度1行へ畳んで受け取る。
const fetchLatestCalculationBatches = async (
  supabase: SupabaseClient,
): Promise<CalculationBatchRow[]> => {
  const { data, error } = await supabase.rpc('report_latest_calculation_batches');
  if (error) {
    throw new Error('算定履歴の取得に失敗しました');
  }
  return (data ?? []) as CalculationBatchRow[];
};

const getCurrentOrganizationId = async (supabase: SupabaseClient): Promise<string> => {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('ログイン情報が確認できませんでした。再度ログインしてください');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('organizationId')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    throw new Error('所属組織を特定できませんでした');
  }

  return (data as ProfileRow).organizationId;
};

const toReportLocation = (row: LocationRow): ReportLocation => ({
  id: row.id,
  name: row.name,
  region: row.region,
  regionLabel: getRegionLabel(row.region),
  type: row.type,
  typeLabel: getLocationTypeLabel(row.type),
});

const toHistoryItem = (row: AuditLogRow): ReportHistoryItem => {
  const detail = safeParseDetail(row.detail);
  const format = detail.format ?? 'PDF';
  const locationCount = detail.locationIds?.length ?? detail.locationCount;
  const totalEmissions = formatEmissionValue(detail.totalEmissions);
  // 拠点選択を使わない種別は、過去に拠点数が記録されていても「組織全体」と表示する
  // （記録当時も内容は組織全体の集計だったため）。判定は reportType に依るが、reportType と
  // 拠点条件は reportType の記録開始以降つねに同時に記録しているため、reportType の無い行は拠点条件も無く、
  // 従来どおり「対象データ未記録」側へ落ちる。
  const targetLabel = detail.reportType && !usesLocationFilter(detail.reportType)
    ? ORGANIZATION_WIDE_TARGET_LABEL
    : locationCount === undefined ? null : `${locationCount}拠点`;
  const targetSummary = [targetLabel, totalEmissions].filter(Boolean).join(' / ') || '対象データ未記録';

  return {
    id: row.id,
    name: detail.name ?? 'レポート生成リクエスト',
    type: detail.type ?? 'レポート',
    fiscalYear: detail.fiscalYear ?? '-',
    format,
    targetSummary,
    generatedAt: formatDateTime(row.createdAt),
    reportType: detail.reportType,
    fiscalYearId: detail.fiscalYearId,
    locationIds: detail.locationIds ?? [],
  };
};

/**
 * 年度に依存しないレポート画面データ（会計年度・拠点・年度別サマリ・出力履歴）。
 * 拠点 × Scope の算定結果は年度スコープのため getReportEmissionResults で別途取得する。
 */
export const getReportBaseData = async (): Promise<ReportBaseData> => {
  const supabase = createClient();
  await getCurrentOrganizationId(supabase);

  const [
    fiscalYearsResult,
    locationsResult,
    aggregatesResult,
    scope3Result,
    batchRows,
    auditLogsResult,
  ] = await Promise.all([
    supabase
      .from('fiscal_years')
      .select('id, label, startDate, endDate')
      .order('startDate', { ascending: false }),
    supabase
      .from('locations')
      .select('id, name, region, type')
      .order('createdAt', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('dashboard_aggregates')
      .select('fiscalYearId, scope1Total, scope2Total, scope3Total, updatedAt')
      .order('updatedAt', { ascending: false }),
    supabase
      .from('scope3_category_emissions')
      .select('fiscalYearId'),
    fetchLatestCalculationBatches(supabase),
    supabase
      .from('system_audit_logs')
      .select('id, detail, createdAt')
      .eq('action', REPORT_AUDIT_ACTION)
      .eq('entityName', REPORT_AUDIT_ENTITY)
      .order('createdAt', { ascending: false })
      .limit(10),
  ]);

  if (fiscalYearsResult.error) throw new Error('算定年度の取得に失敗しました');
  if (locationsResult.error) throw new Error('対象拠点の取得に失敗しました');
  if (aggregatesResult.error) throw new Error('レポート対象集計の取得に失敗しました');
  if (scope3Result.error) throw new Error('Scope 3集計の取得に失敗しました');
  if (auditLogsResult.error) throw new Error('レポート履歴の取得に失敗しました');

  const fiscalYears = ((fiscalYearsResult.data ?? []) as FiscalYearRow[]).map(row => ({
    id: row.id,
    year: extractYear(row),
    label: row.label,
    startDate: row.startDate,
    endDate: row.endDate,
  }));
  const fiscalYearById = new Map(fiscalYears.map(year => [year.id, year]));
  const scope3Rows = (scope3Result.data ?? []) as Scope3CategoryEmissionRow[];

  const summaries = ((aggregatesResult.data ?? []) as DashboardAggregateRow[]).map(row => {
    const fiscalYear = fiscalYearById.get(row.fiscalYearId);
    const scope1Total = toNumber(row.scope1Total);
    const scope2Total = toNumber(row.scope2Total);
    const scope3Total = toNumber(row.scope3Total);
    const relatedScope3Rows = scope3Rows.filter(item => item.fiscalYearId === row.fiscalYearId);
    // RPC が年度ごとに最新の1件だけを返すため、find で当該年度の最新バッチが取れる。
    const latestBatch = batchRows.find(item => item.fiscalYearId === row.fiscalYearId);

    return {
      fiscalYearId: row.fiscalYearId,
      fiscalYear: fiscalYear?.year ?? '',
      fiscalYearLabel: fiscalYear?.label ?? row.fiscalYearId,
      scope1Total,
      scope2Total,
      scope3Total,
      totalEmissions: scope1Total + scope2Total + scope3Total,
      scope3CategoryCount: relatedScope3Rows.length,
      // バッチの processedCount は「その1回で処理した件数」であり年度の算定済み件数ではない
      // （2回目以降の実行では新規分しか数えない）。画面プレビューの「算定済みレコード」は
      // report_location_scope_emissions の recordCount 合計を使うこと（Reports.client.tsx）。
      latestAggregateUpdatedAt: row.updatedAt ?? undefined,
      latestBatchStatus: latestBatch?.status,
      latestBatchCompletedAt: latestBatch?.completedAt ?? latestBatch?.startedAt,
    };
  });

  return {
    fiscalYears,
    locations: ((locationsResult.data ?? []) as LocationRow[]).map(toReportLocation),
    summaries,
    histories: ((auditLogsResult.data ?? []) as AuditLogRow[]).map(toHistoryItem),
  };
};

/** 指定年度の 拠点 × Scope 算定結果（集約済み）。 */
export const getReportEmissionResults = async (
  fiscalYearId: string,
): Promise<ReportEmissionResult[]> => {
  const supabase = createClient();
  const rows = await fetchLocationScopeEmissions(supabase, fiscalYearId);

  return rows.map(row => ({
    fiscalYearId: row.fiscalYearId,
    locationId: row.locationId,
    scope: row.scope,
    emissions: toNumber(row.emissions),
    recordCount: toNumber(row.recordCount),
  }));
};

/**
 * 年度非依存データと当該年度の算定結果をまとめて取得する。
 * 画面（Reports）は年度切替のたびに全体を読み直さないよう両者を別々に呼ぶため、
 * これを使うのは印刷ビューなど「1年度分を一度だけ組み立てる」経路に限る。
 */
export const getReportData = async (fiscalYearId: string): Promise<ReportData> => {
  const [base, emissionResults] = await Promise.all([
    getReportBaseData(),
    getReportEmissionResults(fiscalYearId),
  ]);

  return { ...base, emissionResults };
};

export const createReportGenerationLog = async (
  input: CreateReportHistoryInput,
): Promise<ReportHistoryItem> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);
  const format = input.format.toUpperCase() as 'PDF' | 'CSV';
  const name = `${input.fiscalYearLabel}_${input.reportTypeLabel}`;

  const detail: ReportAuditDetail = {
    reportType: input.reportType,
    fiscalYearId: input.fiscalYearId,
    fiscalYearValue: input.fiscalYear,
    name,
    type: input.reportTypeLabel,
    fiscalYear: input.fiscalYearLabel,
    format,
    // 拠点選択を使わない種別では拠点条件を記録しない（「1拠点」等の誤った条件を残さない）。
    ...(usesLocationFilter(input.reportType)
      ? { locationIds: input.locationIds, locationCount: input.locationIds.length }
      : {}),
    scope1Total: input.scope1Total,
    scope2Total: input.scope2Total,
    scope3Total: input.scope3Total,
    totalEmissions: input.totalEmissions,
  };

  const { data, error } = await supabase
    .from('system_audit_logs')
    .insert({
      organizationId,
      action: REPORT_AUDIT_ACTION,
      entityName: REPORT_AUDIT_ENTITY,
      detail: JSON.stringify(detail),
    })
    .select('id, detail, createdAt')
    .single();

  if (error) {
    throw new Error('レポート生成リクエスト履歴の保存に失敗しました');
  }

  return toHistoryItem(data as AuditLogRow);
};
