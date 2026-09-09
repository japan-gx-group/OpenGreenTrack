// レポート本文（CSV・印刷用PDFビュー共通）の組み立て。
// 集計は既存サービスを再利用する:
//   - 年度別 Scope1/2/3 合計・拠点別 Scope1/2 は reportService.getReportData
//     （dashboard_aggregates と report_location_scope_emissions RPC を集計済み）
//   - Scope 3 カテゴリ別内訳・サプライヤーは scope-analysis の getScopeAnalysisData
//     （scope3_category_emissions / suppliers を集計済み）
//   - 拠点別エネルギー使用量は report_location_energy_usage RPC（DB側で集計）を本ファイルで拠点別に整形
//   - データ充足状況（算定済み/未算定の件数）は report_activity_calculation_coverage RPC（DB側で集計）と、
//     Scope 3 積上げ明細だけをカテゴリ×方式で数える report_scope3_activity_calculation_coverage RPC
// これにより CSV とPDFビューで同一の値・並びになり、画面との集計ドリフトを避ける。

import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabaseRows';
import type { EnergyType } from '@/features/calculation/types';
import {
  isScope3EnergyType,
  scope3CategoryIdForEnergyType,
} from '@/features/calculation/engine/scope3Category';
import { MANUAL_ACTIVITY_CATEGORY_MAP } from '@/features/data-input/types';
import {
  getScopeAnalysisData,
  SCOPE3_CATEGORY_IDS,
  SCOPE3_CATEGORY_NAMES,
  type Scope3Method,
} from '@/features/scope-analysis/services/scopeAnalysisService';
import {
  fetchIdeaCitationsForScope3,
  type IdeaCitation,
} from '@/features/factors/services/ideaImportClient';
import { getRegionLabel } from '@/features/locations/types';
import {
  getReportData,
  type ReportData,
  type ReportFiscalYear,
  type ReportFormat,
  type ReportLocation,
  type ReportTypeId,
} from './reportService';
import { ORGANIZATION_WIDE_TARGET_LABEL, usesLocationFilter } from '../types';

// セル値。数値は「生の number」で保持し、CSV/画面それぞれの都合で整形する
// （CSV は桁区切り無しで Excel に数値と認識させ、画面は日本語ロケールで桁区切り表示）。
export type ReportCell = string | number;

export type ReportSection = {
  heading: string;
  note?: string;
  columns: string[];
  rows: ReportCell[][];
};

export type ReportDocument = {
  documentTitle: string;
  reportTypeLabel: string;
  fiscalYearLabel: string;
  /** 生成時刻（ISO文字列）。表示・ファイル名に使う */
  generatedAt: string;
  meta: { label: string; value: string }[];
  sections: ReportSection[];
};

export type BuildReportInput = {
  reportType: ReportTypeId;
  reportTypeLabel: string;
  fiscalYearId: string;
  format: ReportFormat;
  locationIds: string[];
  /** 画面側で取得済みのデータがあれば再取得を避けるために渡す */
  preloaded?: ReportData;
};

const ENERGY_TYPE_LABELS: Record<string, string> = {
  electricity: '電気',
  city_gas: '都市ガス',
  fuel_heavy_oil: 'A重油',
  fuel_diesel: '軽油',
  water: '水道',
  freight_transport: '輸送',
  business_travel: '出張',
};

// エネルギー種別の日本語ラベル。レポート固有の表記（ENERGY_TYPE_LABELS）を優先し、
// 未定義の種別はデータ入力機能の全種別マップへフォールバックする
// （燃料種別・Scope3積上げなど、生の enum 値をレポートに出さないため）。
const energyTypeLabel = (energyType: string): string =>
  ENERGY_TYPE_LABELS[energyType]
  ?? MANUAL_ACTIVITY_CATEGORY_MAP[energyType as EnergyType]?.labelJP
  ?? energyType;

const toNumber = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDateTimeDisplay = (iso: string): string => {
  const date = new Date(iso);
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

/** report_location_energy_usage RPC の1行（拠点 × エネルギー種別 × 単位 の活動量合計）。 */
type LocationEnergyUsageRow = {
  locationId: string;
  energyType: string;
  unit: string;
  /** 使用量合計。supabase-js からは numeric が string で返ることがある */
  amount: number | string;
};

export type EnergyUsage = { energyType: string; unit: string; amount: number };

// 年度期間の 拠点 × エネルギー種別 × 単位 の活動量合計を DB 側（report_location_energy_usage RPC）
// で集計して取得する。activity_records を全行ブラウザへ取得しない（返る行数は
// 活動量レコード数に比例しない）。
// RLS により自組織の行だけが集計対象になるため、拠点の絞り込みは選択IDで JS 側で行う。
// 集約後も 拠点数 × エネルギー種別数 が PostgREST の max_rows（1000）を超え得るため、
// RPC 側の安定ソート（拠点→種別→単位）に合わせて range() でページングする。
// 戻り値は 拠点ID → エネルギー種別×単位ごとの合計使用量。
const fetchLocationEnergyBreakdown = async (
  fiscalYear: ReportFiscalYear,
  locationIds: string[],
): Promise<Map<string, EnergyUsage[]>> => {
  const supabase = createClient();
  const selected = new Set(locationIds);

  const rows = await fetchAllRows<LocationEnergyUsageRow>(
    (from, to) =>
      supabase
        .rpc('report_location_energy_usage', {
          p_start_date: fiscalYear.startDate,
          p_end_date: fiscalYear.endDate,
        })
        .range(from, to),
    '拠点別エネルギー使用量の取得に失敗しました',
  );

  const byLocation = new Map<string, EnergyUsage[]>();
  for (const row of rows) {
    if (!selected.has(row.locationId)) continue;
    const usages = byLocation.get(row.locationId) ?? [];
    usages.push({ energyType: row.energyType, unit: row.unit, amount: toNumber(row.amount) });
    byLocation.set(row.locationId, usages);
  }

  return byLocation;
};

type PerLocationScope = { scope1: number; scope2: number };

const aggregatePerLocationScope = (
  data: ReportData,
  fiscalYearId: string,
  locationIds: string[],
): Map<string, PerLocationScope> => {
  const selected = new Set(locationIds);
  const perLocation = new Map<string, PerLocationScope>();

  data.emissionResults
    .filter(result => result.fiscalYearId === fiscalYearId && selected.has(result.locationId))
    .forEach(result => {
      const current = perLocation.get(result.locationId) ?? { scope1: 0, scope2: 0 };
      // Scope 3 は emission_results 上、拠点別に按分できない（組織・年度カテゴリ集計のため）。
      // 拠点別内訳は Scope 1/2 のみ積み上げる。
      if (result.scope === 'scope1') current.scope1 += result.emissions;
      else if (result.scope === 'scope2') current.scope2 += result.emissions;
      perLocation.set(result.locationId, current);
    });

  return perLocation;
};

// =========================================================================
// データ充足状況（未算定データの開示）
// =========================================================================

/** report_activity_calculation_coverage RPC の1行（拠点 × エネルギー種別の算定済み/未算定件数）。 */
type ActivityCoverageRawRow = {
  locationId: string;
  energyType: string;
  /** 件数は bigint のため supabase-js からは string で返ることがある */
  calculatedCount: number | string;
  uncalculatedCount: number | string;
};

/** 算定済み/未算定の件数だけを持つ最小形（拠点別・カテゴリ別のどちらの行でも合算できる）。 */
export type CoverageCounts = {
  calculatedCount: number;
  uncalculatedCount: number;
};

/** 拠点 × エネルギー種別ごとの算定済み/未算定レコード件数。 */
export type ActivityCoverageRow = CoverageCounts & {
  locationId: string;
  energyType: string;
};

/** report_scope3_activity_calculation_coverage RPC の1行。 */
type Scope3CoverageRawRow = {
  categoryId: number | null;
  method: Scope3Method;
  /** 件数は bigint のため supabase-js からは string で返ることがある */
  calculatedCount: number | string;
  uncalculatedCount: number | string;
};

/** Scope 3 積上げ明細（IDEA）の、カテゴリ × 採用方式ごとの算定済み/未算定レコード件数。 */
export type Scope3CoverageRow = CoverageCounts & {
  /** `null` = カテゴリ未設定の明細（どのカテゴリの採用値にもならない） */
  categoryId: number | null;
  method: Scope3Method;
};

export type DataCoverageInput = {
  /** 対象範囲に絞り込み済みの件数行。`null` = 取得に失敗した（注記でフォールバックする） */
  rows: CoverageCounts[] | null;
  /** 集計範囲の説明（注記に埋め込む。例:「対象拠点の活動量データ」） */
  scopeLabel: string;
  /**
   * 算定済みでもレポートの排出量に採用されないため、件数・充足率から除外したレコード数。
   * 0 / 未指定なら注記を出さない。
   */
  excludedCount?: number;
};

/**
 * 集計値のセクション注記へ付ける未算定の警告文（未算定が無ければ undefined）。
 * 純関数・テスト対象。レポートの排出量が「入力済みデータのうち算定できた分だけ」で
 * あることを、集計表のすぐ隣で明示するために使う。
 */
export const uncalculatedWarningNote = (uncalculatedCount: number): string | undefined =>
  uncalculatedCount > 0
    ? `※ 未算定の活動量データが ${uncalculatedCount} 件あります。下記の排出量にはこれらが含まれていません（「データ充足状況」参照）。`
    : undefined;

/** 注記の合成（undefined を落として1文にまとめる）。 */
const joinNotes = (...notes: (string | undefined)[]): string | undefined =>
  notes.filter((note): note is string => Boolean(note)).join(' ') || undefined;

/** 未算定件数の合計。取得できていない（null）場合は 0 とし、警告を出さない。 */
const sumUncalculated = (rows: CoverageCounts[] | null): number =>
  (rows ?? []).reduce((sum, row) => sum + row.uncalculatedCount, 0);

/** 算定済み・未算定を合わせたレコード件数の合計。 */
const sumRecords = (rows: CoverageCounts[] | null): number =>
  (rows ?? []).reduce((sum, row) => sum + row.calculatedCount + row.uncalculatedCount, 0);

/**
 * データ充足状況セクション（純関数・テスト対象）。
 * 未算定レコードは emission_results を持たず、レポートの集計値にも現れないため、
 * 件数と充足率を本文に載せて「集計できた分の合計」を全体の排出量と誤認させないようにする。
 * 拠点×種別の内訳は開示に必要な情報ではなく運用上の手掛かりなので載せない
 * （どのレコードが未算定かはデータ入力画面で確認する）。
 * 算定済みでもレポートの排出量に採用されないレコード（算定方法が直接入力のカテゴリの
 * Scope 3 活動量）は呼び出し側で `rows` から外し、件数だけを `excludedCount` で渡す。
 * 分母・分子に混ぜると「充足率100%だが1件も反映されていない」と読める表になるため。
 */
export const buildDataCoverageSection = (input: DataCoverageInput): ReportSection => {
  if (input.rows === null) {
    return {
      heading: 'データ充足状況',
      note: '未算定データの件数を取得できませんでした。データ入力画面で未算定レコードの有無を確認してください。',
      columns: ['区分', '件数', '割合'],
      rows: [],
    };
  }

  const calculated = input.rows.reduce((sum, row) => sum + row.calculatedCount, 0);
  const uncalculated = sumUncalculated(input.rows);
  const total = calculated + uncalculated;
  // 算定済み・未算定を独立に丸めると合計が 100.0% にならない（例 35.3% + 64.8%）ため、
  // 未算定は「100.0 − 算定済み%」で導出し、表の3行が常に整合するようにする。
  const calculatedRatio = total > 0 ? ((calculated / total) * 100).toFixed(1) : '0.0';
  const uncalculatedRatio = total > 0 ? (100 - Number(calculatedRatio)).toFixed(1) : '0.0';

  return {
    heading: 'データ充足状況',
    // 充足率の意味と限界を明記する。件数ベースの割合は欠落した排出量の規模を表さず、
    // そもそも入力されていないデータはこの集計では検知できない。
    note: joinNotes(
      `${input.scopeLabel}のうち、排出量を算定できたレコードの割合です。未算定のレコードは本レポートの排出量に含まれていません。充足率は件数ベースのため、欠落している排出量の規模を表すものではありません。また、システムに未入力のデータは検知できません。`,
      uncalculated > 0
        ? '未算定は、適用できる排出係数が無い、活動量の単位を係数の単位に換算できない、同順位の係数が複数該当して一意に決まらない、算定をまだ実行していない、などのレコードです。原因を取り除いたうえで算定を再実行すると解消します。'
        : undefined,
      (input.excludedCount ?? 0) > 0
        ? `算定方法が「直接入力」のカテゴリに属する Scope 3 の活動量データ ${input.excludedCount} 件は、算定済みでも本レポートの排出量には採用されないため、上記の件数・充足率から除いています（採用するにはScope分析画面でカテゴリの算定方法を「積上げ算定」に切り替えます）。`
        : undefined,
    ),
    columns: ['区分', '件数', '割合'],
    rows: [
      ['算定済み', calculated, `${calculatedRatio}%`],
      ['未算定', uncalculated, `${uncalculatedRatio}%`],
      ['合計', total, total > 0 ? '100.0%' : '0.0%'],
    ],
  };
};

// 対象期間の活動量レコードの算定済み/未算定件数を DB 側（report_activity_calculation_coverage
// RPC）で集計して取得する。 と同じ方針で activity_records を全行ブラウザへ取得しない。
// RLS により自組織の行だけが集計対象になるため、拠点・種別の絞り込みは呼び出し側で行う。
// 集約後も 拠点数 × エネルギー種別数 が PostgREST の max_rows（1000）を超え得るため、
// RPC 側の安定ソート（拠点→種別）に合わせて range() でページングする。
// 取得失敗はレポート生成全体を止めず、null を返して注記側でフォールバックする
// （算定方法欄の引用情報と同じ方針）。
const fetchActivityCoverage = async (
  fiscalYear: ReportFiscalYear,
): Promise<ActivityCoverageRow[] | null> => {
  const supabase = createClient();
  try {
    const rows = await fetchAllRows<ActivityCoverageRawRow>(
      (from, to) =>
        supabase
          .rpc('report_activity_calculation_coverage', {
            p_start_date: fiscalYear.startDate,
            p_end_date: fiscalYear.endDate,
          })
          .range(from, to),
      'データ充足状況の取得に失敗しました',
    );
    return rows.map(row => ({
      locationId: row.locationId,
      energyType: row.energyType,
      calculatedCount: toNumber(row.calculatedCount),
      uncalculatedCount: toNumber(row.uncalculatedCount),
    }));
  } catch {
    return null;
  }
};

// Scope 3 積上げ明細（IDEA 連携。energyType = 'scope3_activity'）は、カテゴリが行の
// scope3CategoryId で決まるため 拠点 × 種別 の件数では方式を判定できない。カテゴリ × 採用方式で
// 数える report_scope3_activity_calculation_coverage RPC を別に引く。
// 行数はカテゴリ数（最大15）+ カテゴリ未設定の1行に収まるため、ページングは不要。
// 取得失敗は fetchActivityCoverage と同じくレポート生成を止めず null を返す。
const fetchScope3ActivityCoverage = async (
  fiscalYear: ReportFiscalYear,
): Promise<Scope3CoverageRow[] | null> => {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('report_scope3_activity_calculation_coverage', {
    p_fiscal_year_id: fiscalYear.id,
  });

  if (error) {
    return null;
  }

  return ((data ?? []) as Scope3CoverageRawRow[]).map(row => ({
    categoryId: row.categoryId,
    method: row.method,
    calculatedCount: toNumber(row.calculatedCount),
    uncalculatedCount: toNumber(row.uncalculatedCount),
  }));
};

/** IDEA 積上げの energyType。カテゴリは行の scope3CategoryId が担うため種別からは引けない。 */
const SCOPE3_ACTIVITY_ENERGY_TYPE = 'scope3_activity';

/** そのカテゴリの算定結果が採用されるか（方式行が無いカテゴリは direct 既定）。 */
const isAdoptedCategory = (categoryId: number | null, methods: Map<number, Scope3Method>): boolean =>
  categoryId !== null && (methods.get(categoryId) ?? 'direct') === 'calculated';

/**
 * 充足状況の件数行を「レポートの排出量に採用され得るもの」と「採用されないもの」に分ける
 * （純関数・テスト対象）。
 *
 * 算定バッチは方式（scope3_category_methods.method）を見ずに未算定レコードを全件算定するため、
 * 算定方法が直接入力のカテゴリに属する Scope 3 の活動量も「算定済み」になる。しかしカテゴリ別の
 * 採用値は direct のカテゴリでは直接入力値だけを採るので、これらは 1 件もレポートの排出量に効かない。
 * 分母・分子に混ぜると「充足率100%だが1件も反映されていない」と読める表になるため、採用され得る
 * ものだけを数え、残りは件数（`excludedCount`）として注記に回す。
 *
 * Scope 1・2 は方式の概念が無いためそのまま採用側。Scope 3 のうち標準係数の種別（廃棄物・出張・
 * 通勤ほか）は energyType からカテゴリを引いて方式を見る。IDEA 積上げはカテゴリが行ごとに違うため、
 * 拠点 × 種別の行からは外し、カテゴリ × 方式で数えた `scope3ActivityRows` を使う。
 */
export const splitCoverageByAdoption = (input: {
  /** レポート種別ごとの範囲で絞り込み済みの 拠点 × エネルギー種別 件数行 */
  rows: ActivityCoverageRow[] | null;
  /** Scope 3 積上げ明細の カテゴリ × 方式 件数行。Scope 3 を数えないレポート種別では `[]` */
  scope3ActivityRows: Scope3CoverageRow[] | null;
  /** カテゴリID → 方式（行が無いカテゴリは direct 既定） */
  methods: Map<number, Scope3Method>;
}): { adopted: CoverageCounts[] | null; excludedCount: number } => {
  if (input.rows === null || input.scope3ActivityRows === null) {
    return { adopted: null, excludedCount: 0 };
  }

  const adopted: CoverageCounts[] = [];
  const excluded: CoverageCounts[] = [];

  for (const row of input.rows) {
    if (!isScope3EnergyType(row.energyType)) {
      adopted.push(row);
      continue;
    }
    if (row.energyType === SCOPE3_ACTIVITY_ENERGY_TYPE) continue;
    const categoryId = scope3CategoryIdForEnergyType(row.energyType as EnergyType);
    (isAdoptedCategory(categoryId, input.methods) ? adopted : excluded).push(row);
  }

  for (const row of input.scope3ActivityRows) {
    (row.categoryId !== null && row.method === 'calculated' ? adopted : excluded).push(row);
  }

  return { adopted, excludedCount: sumRecords(excluded) };
};

/** 取得済みの件数行を、レポート種別ごとの対象範囲へ絞り込む（null＝取得失敗はそのまま伝播）。 */
const filterCoverage = (
  rows: ActivityCoverageRow[] | null,
  predicate: (row: ActivityCoverageRow) => boolean,
): ActivityCoverageRow[] | null => (rows === null ? null : rows.filter(predicate));

/** レポート種別ごとの「データ充足状況」の対象範囲。 */
export type CoverageScope = {
  predicate: (row: ActivityCoverageRow) => boolean;
  /** 注記に埋め込む集計範囲の説明 */
  scopeLabel: string;
};

/**
 * レポート種別ごとの充足状況の対象範囲（純関数・テスト対象）。
 * 未算定の警告は「集計表に載るはずだった排出量が欠けている」ことを伝えるものなので、
 * 数える範囲は種別ごとの集計値の範囲と一致させる必要がある。範囲判定をここへ一本化する。
 *
 * Scope 3（標準係数の廃棄物・出張・通勤ほかと IDEA 積上げ）は組織・年度単位の集計で、
 * 拠点の選択に関わらずレポートの Scope 3 行に効く。逆に拠点別レポートの集計表は
 * Scope 1・2 限定で、Scope 3 は算定してもその表には入らない。そのため:
 *   - 年次サマリ: Scope 3 の種別は拠点を問わず全件、それ以外は選択拠点分を数える
 *     （選択外の拠点に未算定の出張・通勤・廃棄物があっても充足率 100% と出ないようにする）
 *   - Scope 3 詳細: 拠点では絞らず Scope 3 の種別だけを数える
 *   - 拠点別: 選択拠点のうち Scope 3 以外の種別だけを数える
 */
export const coverageScopeForReport = (input: {
  reportType: ReportTypeId;
  locationIds: string[];
}): CoverageScope => {
  const selectedLocationIds = new Set(input.locationIds);

  if (input.reportType === 'scope3_detail') {
    return {
      predicate: row => isScope3EnergyType(row.energyType),
      scopeLabel: '対象年度・組織全体の Scope 3 活動量データ',
    };
  }

  if (input.reportType === 'location_breakdown') {
    return {
      predicate: row =>
        selectedLocationIds.has(row.locationId) && !isScope3EnergyType(row.energyType),
      scopeLabel: '対象拠点の Scope 1・2 活動量データ',
    };
  }

  return {
    predicate: row => isScope3EnergyType(row.energyType) || selectedLocationIds.has(row.locationId),
    scopeLabel: '対象拠点の Scope 1・2 活動量データおよび組織全体の Scope 3 活動量データ',
  };
};

const buildAnnualSummarySections = (
  selectedLocations: ReportLocation[],
  perLocation: Map<string, PerLocationScope>,
  selectedScope1: number,
  selectedScope2: number,
  orgScope3: number,
  uncalculatedCount: number,
): ReportSection[] => {
  const total = selectedScope1 + selectedScope2 + orgScope3;
  const ratio = (value: number): string => (total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%');

  const summarySection: ReportSection = {
    heading: '排出量サマリ',
    note: joinNotes(
      'Scope 1・2 は選択拠点の算定結果、Scope 3 は組織・年度単位のカテゴリ集計です。',
      uncalculatedWarningNote(uncalculatedCount),
    ),
    columns: ['区分', '排出量 (t-CO2e)', '構成比'],
    rows: [
      ['Scope 1', selectedScope1, ratio(selectedScope1)],
      ['Scope 2', selectedScope2, ratio(selectedScope2)],
      ['Scope 3', orgScope3, ratio(orgScope3)],
      ['合計', total, total > 0 ? '100.0%' : '0.0%'],
    ],
  };

  const locationSection: ReportSection = {
    heading: '対象拠点別 Scope 1・2 排出量',
    columns: ['拠点名', 'Scope 1 (t-CO2e)', 'Scope 2 (t-CO2e)', '合計 (t-CO2e)'],
    rows: selectedLocations.map(location => {
      const scope = perLocation.get(location.id) ?? { scope1: 0, scope2: 0 };
      return [location.name, scope.scope1, scope.scope2, scope.scope1 + scope.scope2];
    }),
  };

  return [summarySection, locationSection];
};

// =========================================================================
// Scope 3 算定方法セクション（docs/idea-scope3-spec.md §5.2 レポート行）
// =========================================================================

export type Scope3MethodReportInput = {
  /** カテゴリID → 方式。行が無いカテゴリは 'direct' 既定（scope3_category_methods と同じ） */
  methods: Map<number, Scope3Method>;
  /**
   * 対象年度の積上げ算定結果が実際に参照している IDEA インポートの引用情報（適用時の版）。
   * `[]` = 参照している算定結果が無い、`null` = 取得に失敗した（注記で区別する）。
   */
  citations: IdeaCitation[] | null;
};

const SCOPE3_METHOD_LABELS: Record<Scope3Method, string> = {
  direct: '直接入力（カテゴリ別排出量の登録値）',
  calculated: '積上げ算定（IDEA原単位 × 活動量）',
};

/**
 * Scope 3 の算定方法欄を組み立てる（純関数・テスト対象）。
 * 積上げ算定を採用しているカテゴリがある場合は IDEA の引用表記（citationText）と
 * GWP モデル名を出典として記載する。出典は「現在 active な版」ではなく対象年度の算定に
 * 適用した版で、版更新をまたいで算定した年度では複数版を列挙する。
 * ライセンス制約（仕様書 §0.2）により、排出原単位（係数値）の一覧は載せない。
 */
export const buildScope3MethodSection = (input: Scope3MethodReportInput): ReportSection => {
  const rows: ReportCell[][] = SCOPE3_CATEGORY_IDS.map(categoryId => {
    const method = input.methods.get(categoryId) ?? 'direct';
    return [
      `${categoryId}. ${SCOPE3_CATEGORY_NAMES[categoryId] ?? `カテゴリ${categoryId}`}`,
      SCOPE3_METHOD_LABELS[method],
    ];
  });

  const hasCalculated = SCOPE3_CATEGORY_IDS.some(
    categoryId => (input.methods.get(categoryId) ?? 'direct') === 'calculated',
  );

  let note: string | undefined;
  if (hasCalculated) {
    if (input.citations === null) {
      note =
        '積上げ算定を採用しているカテゴリがありますが、IDEAデータベースの取込情報を取得できませんでした。係数管理画面で取込状況を確認してください。';
    } else if (input.citations.length === 0) {
      // 引用が空でも積上げ結果が無いとは限らない: 標準係数（IDEA 以外）だけで算定した年度は
      // 参照している IDEA の版が無いため空になる。結果の有無ではなく「IDEA を参照していない」と書く。
      note =
        '積上げ算定を採用しているカテゴリがありますが、対象年度の算定結果に IDEA データベースを参照したものがありません。標準係数のみで算定した場合はこの表示になります。積上げ明細を入力していない場合はデータ入力・算定の実行状況を確認してください。';
    } else {
      const sources = input.citations
        .map(citation => `${citation.citationText}（GWPモデル: ${citation.gwpModel}）`)
        .join(' / ');
      note = `積上げ算定の排出原単位は IDEA データベースに基づく。出典（対象年度の算定に適用した版）: ${sources}。ライセンス条件により排出原単位（係数値）の一覧は本レポートに掲載しない。`;
    }
  }

  return {
    heading: 'Scope 3 算定方法',
    note,
    columns: ['カテゴリ', '算定方法'],
    rows,
  };
};

// カテゴリ別の算定方法（scope3_category_methods）を取得する。RLS により自組織の行のみ返る。
const fetchScope3Methods = async (fiscalYearId: string): Promise<Map<number, Scope3Method>> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('scope3_category_methods')
    .select('categoryId, method')
    .eq('fiscalYearId', fiscalYearId);

  if (error) {
    throw new Error('Scope 3 の算定方法の取得に失敗しました');
  }

  return new Map(
    ((data ?? []) as { categoryId: number; method: Scope3Method }[]).map(row => [
      row.categoryId,
      row.method,
    ]),
  );
};

// Scope 3 算定方法セクションの入力を取得する。IDEA の引用情報は積上げ算定の採用が
// 1カテゴリでもある場合のみ引く（未採用の組織に不要なクエリを出さない）。
// 引用は対象年度の算定結果が参照している版から引く（active な版ではない。理由は
// fetchIdeaCitationsForScope3 のコメント）。
// 引用情報の取得失敗はレポート生成全体を止めず、注記側でフォールバックする。
const fetchScope3MethodReportInput = async (
  fiscalYear: ReportFiscalYear,
): Promise<Scope3MethodReportInput> => {
  const methods = await fetchScope3Methods(fiscalYear.id);
  const calculatedCategoryIds = [...methods.entries()]
    .filter(([, method]) => method === 'calculated')
    .map(([categoryId]) => categoryId);

  if (calculatedCategoryIds.length === 0) {
    return { methods, citations: [] };
  }

  try {
    const citations = await fetchIdeaCitationsForScope3({
      startDate: fiscalYear.startDate,
      endDate: fiscalYear.endDate,
      categoryIds: calculatedCategoryIds,
    });
    return { methods, citations };
  } catch {
    return { methods, citations: null };
  }
};

const buildScope3DetailSections = (
  scope: Awaited<ReturnType<typeof getScopeAnalysisData>>,
): ReportSection[] => {
  const categorySection: ReportSection = {
    heading: 'Scope 3 カテゴリ別排出量',
    columns: ['カテゴリ', '排出量 (t-CO2e)', '構成比'],
    rows: scope.categories.map(category => [
      `${category.id}. ${category.name}`,
      category.emissions,
      category.percentage,
    ]),
  };

  const supplierSection: ReportSection = {
    heading: '主要サプライヤー',
    note: 'サプライヤー別排出量は、サプライヤー×年度×カテゴリ単位で登録された実績値です。',
    columns: ['サプライヤー', 'カテゴリ', '排出量 (t-CO2e)', '一次データ率 (%)'],
    rows: scope.suppliers.map(supplier => [
      supplier.name,
      supplier.category,
      supplier.emissionsNum,
      supplier.rate,
    ]),
  };

  return [categorySection, supplierSection];
};

const buildLocationBreakdownSections = (
  selectedLocations: ReportLocation[],
  perLocation: Map<string, PerLocationScope>,
  energyByLocation: Map<string, EnergyUsage[]>,
  uncalculatedCount: number,
): ReportSection[] => {
  const emissionSection: ReportSection = {
    heading: '拠点別排出量（Scope 1・2）',
    note: uncalculatedWarningNote(uncalculatedCount),
    columns: ['拠点名', '地域', 'Scope 1 (t-CO2e)', 'Scope 2 (t-CO2e)', '合計 (t-CO2e)'],
    rows: selectedLocations.map(location => {
      const scope = perLocation.get(location.id) ?? { scope1: 0, scope2: 0 };
      return [
        location.name,
        getRegionLabel(location.region),
        scope.scope1,
        scope.scope2,
        scope.scope1 + scope.scope2,
      ];
    }),
  };

  const energyRows: ReportCell[][] = [];
  for (const location of selectedLocations) {
    const usages = energyByLocation.get(location.id) ?? [];
    for (const usage of usages) {
      energyRows.push([
        location.name,
        energyTypeLabel(usage.energyType),
        usage.amount,
        usage.unit,
      ]);
    }
  }

  const energySection: ReportSection = {
    heading: '拠点別エネルギー使用量',
    note: energyRows.length === 0 ? '対象年度・対象拠点の活動量データがありません。' : undefined,
    columns: ['拠点名', 'エネルギー種別', '使用量', '単位'],
    rows: energyRows,
  };

  return [emissionSection, energySection];
};

export const buildReportDocument = async (input: BuildReportInput): Promise<ReportDocument> => {
  // preloaded が無い経路（印刷ビュー直打ち）でも、算定結果は対象年度分だけを取得する。
  const data = input.preloaded ?? (await getReportData(input.fiscalYearId));
  const fiscalYear = data.fiscalYears.find(year => year.id === input.fiscalYearId);
  if (!fiscalYear) {
    throw new Error('対象の算定年度が見つかりません');
  }

  const summary = data.summaries.find(item => item.fiscalYearId === input.fiscalYearId);
  const selectedLocations = data.locations.filter(location => input.locationIds.includes(location.id));
  const perLocation = aggregatePerLocationScope(data, input.fiscalYearId, input.locationIds);
  const selectedScope1 = [...perLocation.values()].reduce((sum, value) => sum + value.scope1, 0);
  const selectedScope2 = [...perLocation.values()].reduce((sum, value) => sum + value.scope2, 0);
  const orgScope3 = summary?.scope3Total ?? 0;

  const generatedAt = new Date().toISOString();

  // データ充足状況はどのレポート種別にも載せるため、種別ごとの取得と並行して先に投げる。
  // Scope 3 積上げ明細（カテゴリ × 方式）は数える単位が違うため別の RPC を引く。拠点別レポートは
  // Scope 3 を数えないので引かない（採用判定にも使わない）。
  const coveragePromise = fetchActivityCoverage(fiscalYear);
  const scope3CoveragePromise: Promise<Scope3CoverageRow[] | null> =
    input.reportType === 'location_breakdown'
      ? Promise.resolve([])
      : fetchScope3ActivityCoverage(fiscalYear);
  const coverageScope = coverageScopeForReport({
    reportType: input.reportType,
    locationIds: input.locationIds,
  });

  let sections: ReportSection[];
  if (input.reportType === 'scope3_detail') {
    // 方式（direct/calculated）と IDEA 引用表記を「Scope 3 算定方法」欄として自動記載する。
    const [scope, methodInput, coverageRows, scope3CoverageRows] = await Promise.all([
      getScopeAnalysisData(fiscalYear.year, fiscalYear.id),
      fetchScope3MethodReportInput(fiscalYear),
      coveragePromise,
      scope3CoveragePromise,
    ]);
    const { adopted, excludedCount } = splitCoverageByAdoption({
      rows: filterCoverage(coverageRows, coverageScope.predicate),
      scope3ActivityRows: scope3CoverageRows,
      methods: methodInput.methods,
    });
    sections = [
      ...buildScope3DetailSections(scope),
      buildDataCoverageSection({
        rows: adopted,
        scopeLabel: coverageScope.scopeLabel,
        excludedCount,
      }),
      buildScope3MethodSection(methodInput),
    ];
  } else if (input.reportType === 'location_breakdown') {
    const [energyByLocation, coverageRows] = await Promise.all([
      fetchLocationEnergyBreakdown(fiscalYear, input.locationIds),
      coveragePromise,
    ]);
    const coverage = filterCoverage(coverageRows, coverageScope.predicate);
    sections = [
      ...buildLocationBreakdownSections(
        selectedLocations,
        perLocation,
        energyByLocation,
        sumUncalculated(coverage),
      ),
      buildDataCoverageSection({ rows: coverage, scopeLabel: coverageScope.scopeLabel }),
    ];
  } else {
    // 年次サマリにも Scope 3 の算定方法欄を含める（Scope 3 行の根拠を明示する）。
    const [methodInput, coverageRows, scope3CoverageRows] = await Promise.all([
      fetchScope3MethodReportInput(fiscalYear),
      coveragePromise,
      scope3CoveragePromise,
    ]);
    const { adopted, excludedCount } = splitCoverageByAdoption({
      rows: filterCoverage(coverageRows, coverageScope.predicate),
      scope3ActivityRows: scope3CoverageRows,
      methods: methodInput.methods,
    });
    sections = [
      ...buildAnnualSummarySections(
        selectedLocations,
        perLocation,
        selectedScope1,
        selectedScope2,
        orgScope3,
        sumUncalculated(adopted),
      ),
      buildDataCoverageSection({
        rows: adopted,
        scopeLabel: coverageScope.scopeLabel,
        excludedCount,
      }),
      buildScope3MethodSection(methodInput),
    ];
  }

  return {
    documentTitle: `${fiscalYear.label}_${input.reportTypeLabel}`,
    reportTypeLabel: input.reportTypeLabel,
    fiscalYearLabel: fiscalYear.label,
    generatedAt,
    meta: buildReportMeta({
      reportType: input.reportType,
      reportTypeLabel: input.reportTypeLabel,
      fiscalYearLabel: fiscalYear.label,
      selectedLocationCount: selectedLocations.length,
      generatedAt,
    }),
    sections,
  };
};

// レポート冒頭のメタ情報。
// Scope 3 詳細は拠点選択を使わない組織全体の集計のため、「対象拠点数: N 拠点」ではなく
// 「対象拠点: 組織全体」と印字し、絞り込んだ拠点の数値だと誤読されないようにする。
export const buildReportMeta = (input: {
  reportType: ReportTypeId;
  reportTypeLabel: string;
  fiscalYearLabel: string;
  selectedLocationCount: number;
  generatedAt: string;
}): ReportDocument['meta'] => [
  { label: '対象年度', value: input.fiscalYearLabel },
  { label: 'レポート種別', value: input.reportTypeLabel },
  usesLocationFilter(input.reportType)
    ? { label: '対象拠点数', value: `${input.selectedLocationCount} 拠点` }
    : { label: '対象拠点', value: ORGANIZATION_WIDE_TARGET_LABEL },
  { label: '出力日時', value: formatDateTimeDisplay(input.generatedAt) },
];

// 画面・PDFビュー用の数値整形（桁区切りあり）。
export const formatCellForDisplay = (cell: ReportCell): string => {
  if (typeof cell === 'number') {
    return cell.toLocaleString('ja-JP', { maximumFractionDigits: 3 });
  }
  return cell;
};

export const isNumericCell = (cell: ReportCell): boolean => typeof cell === 'number';
