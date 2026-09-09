// ダッシュボード読み取りRPC（dashboard_monthly_emissions / dashboard_location_emissions_by_scope）の
// 集計行をグラフ・KPI表示用の系列へ変換する純粋関数。
// dashboardService（データ取得）とテストで共有するため、ここには I/O を置かない。
// 集計そのものは DB 側（supabase/migrations/20260831000002_rpc.sql）で行い、ここでは
// 「月初日×Scope の合計行」を年度内インデックス（期首月=0）の12ヶ月系列へ振り分けるだけにする。
import {
  buildFiscalYearMonthLabels,
  getFiscalYearMonthIndex,
  normalizeFiscalYearStartMonth,
} from '@/lib/fiscal-year/fiscalYearPeriod';
import { calculateDiffPercent, toNumber } from './locationAggregation';

/** dashboard_monthly_emissions RPC の1行（月初日 × Scope の排出量合計）。 */
export type MonthlyEmissionRow = {
  /** 月初日 'YYYY-MM-DD' */
  monthStart: string;
  scope: 'scope1' | 'scope2' | 'scope3';
  /** 排出量合計（numeric(15,3)）。supabase-js からは string で返ることがある */
  emissions: number | string;
};

export type DashboardMonthlyPoint = {
  name: string;
  scope1: number;
  scope2: number;
  scope3: number;
  // 昨年度同月の総排出量（Scope 1+2+3）。その月に前年度のレコードが1件も無い場合は null
  // （0 ではない。0 は「排出0のレコードがある」ことを表す）。グラフ側は connectNulls={false}
  // で線を途切れさせ、全月 null のときは表示側で系列ごと非表示にする。
  previousYearTotal: number | null;
};

export type LocationMonthlyPoint = {
  name: string;
  scope1: number;
  scope2: number;
  // 昨年度同月の合計（拠点絞り込み中は Scope 1+2）。その月に前年度のレコードが1件も無い場合は
  // null（0 ではない）。全月 null のときは表示側で系列ごと非表示にする。
  previousYearTotal: number | null;
};

export type LocationDashboardData = {
  scope1Total: number;
  scope2Total: number;
  /** Scope 1 + Scope 2 の合計。Scope 3 は拠点単位で持てないため含まない。 */
  combinedTotal: number;
  scope1DiffPercent: number | null;
  scope2DiffPercent: number | null;
  totalDiffPercent: number | null;
  monthlyData: LocationMonthlyPoint[];
};

type ScopeKey = MonthlyEmissionRow['scope'];

// 月別×Scope の集計行を、年度内インデックス（期首月=0）の12要素配列へ振り分ける。
const buildMonthlyScopeTotals = (
  rows: MonthlyEmissionRow[],
  fiscalYearStartMonth: number,
): Record<ScopeKey, number[]> => {
  const totals: Record<ScopeKey, number[]> = {
    scope1: buildFiscalYearMonthLabels(fiscalYearStartMonth).map(() => 0),
    scope2: buildFiscalYearMonthLabels(fiscalYearStartMonth).map(() => 0),
    scope3: buildFiscalYearMonthLabels(fiscalYearStartMonth).map(() => 0),
  };

  rows.forEach(row => {
    const monthIndex = getFiscalYearMonthIndex(row.monthStart, fiscalYearStartMonth);
    if (monthIndex === null) return;
    totals[row.scope][monthIndex] += toNumber(row.emissions);
  });

  return totals;
};

// 指定 Scope の合計（月をまたいだ年度合計）。
const sumByScope = (rows: MonthlyEmissionRow[], scope: ScopeKey): number =>
  rows.reduce(
    (total, row) => (row.scope === scope ? total + toNumber(row.emissions) : total),
    0,
  );

// 昨年度の月別合計を年度内インデックス（期首月=0）で組み立てる（比較ライン用の純粋関数）。
// includeScope3: 組織全体チャートでは true（積み上げバーと同じ集計系統）、拠点絞り込みでは
// Scope 3 が拠点単位で持てないため false にして当年度バー（Scope 1+2）と比較軸を揃える。
// 集計対象の行が1件も無い月は 0 ではなく null にする。年度途中から利用を開始した
// 組織では「未記録の月」と「排出0の月」を区別する必要があり、0 で埋めると比較線が
// 未記録の月で 0 に張り付いて前年比を誤読させるため。全月 null なら配列ごと null を返し、
// 表示側で系列ごと非表示にできるようにする。
export const buildPreviousYearMonthlyTotals = (
  rows: MonthlyEmissionRow[],
  options: { includeScope3: boolean; fiscalYearStartMonth?: number | null },
): (number | null)[] | null => {
  const startMonth = normalizeFiscalYearStartMonth(options.fiscalYearStartMonth);
  const targetRows = rows.filter(
    row =>
      (options.includeScope3 || row.scope !== 'scope3') &&
      getFiscalYearMonthIndex(row.monthStart, startMonth) !== null,
  );
  if (targetRows.length === 0) return null;

  const totals = buildMonthlyScopeTotals(targetRows, startMonth);
  const monthsWithRows = new Set(
    targetRows.map(row => getFiscalYearMonthIndex(row.monthStart, startMonth)),
  );
  return totals.scope1.map((value, monthIndex) =>
    monthsWithRows.has(monthIndex)
      ? value + totals.scope2[monthIndex] + totals.scope3[monthIndex]
      : null,
  );
};

// 組織全体の月別推移（Scope 1/2/3 の積み上げ + 昨年度ライン）を組み立てる。
// 昨年度ラインは当年度の積み上げバーと同じ集計系統（活動量由来の emission_results、
// Scope 1+2+3）で組み立て、同じチャート内で比較軸がズレないようにする。
// NOTE: 月別の Scope 3 は活動量に紐づく emission_results（scope='scope3'）からのみ積み上がる。
// Scope 3 を年次集計（scope3_category_emissions）だけで保持する組織では月次内訳が無いため、
// このチャートの Scope 3 バーは0のままになり得る（KPIカード/円グラフの年次合計とは一致しない）。
export const buildDashboardMonthlyData = (
  currentRows: MonthlyEmissionRow[],
  previousRows: MonthlyEmissionRow[],
  fiscalYearStartMonth?: number | null,
): DashboardMonthlyPoint[] => {
  const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
  const current = buildMonthlyScopeTotals(currentRows, startMonth);
  const previousYearTotals = buildPreviousYearMonthlyTotals(previousRows, {
    includeScope3: true,
    fiscalYearStartMonth: startMonth,
  });

  return buildFiscalYearMonthLabels(startMonth).map((name, monthIndex) => ({
    name,
    scope1: current.scope1[monthIndex],
    scope2: current.scope2[monthIndex],
    scope3: current.scope3[monthIndex],
    previousYearTotal: previousYearTotals?.[monthIndex] ?? null,
  }));
};

// 拠点絞り込み時の KPI（Scope 1/2 と前年比）と月別推移（Scope 1/2 のみ）を組み立てる。
// - currentRows: 当年度・当該拠点の月別×Scope 集計行
// - previousRows: 前年度・当該拠点の月別×Scope 集計行（前年比の分母。無ければ空配列）
// 拠点の合計は Scope 1/2 のみ。Scope 3 は組織・年度単位でしか持てないため常に除外する。
export const buildLocationDashboardData = (
  currentRows: MonthlyEmissionRow[],
  previousRows: MonthlyEmissionRow[],
  options: { fiscalYearStartMonth?: number | null } = {},
): LocationDashboardData => {
  const startMonth = normalizeFiscalYearStartMonth(options.fiscalYearStartMonth);
  const current = buildMonthlyScopeTotals(currentRows, startMonth);
  // 拠点絞り込み中のバーは Scope 1+2 のみのため、昨年度ラインも同じ集計系統で揃える。
  const previousYearTotals = buildPreviousYearMonthlyTotals(previousRows, {
    includeScope3: false,
    fiscalYearStartMonth: startMonth,
  });

  const monthlyData: LocationMonthlyPoint[] = buildFiscalYearMonthLabels(startMonth).map(
    (name, monthIndex) => ({
      name,
      scope1: current.scope1[monthIndex],
      scope2: current.scope2[monthIndex],
      previousYearTotal: previousYearTotals?.[monthIndex] ?? null,
    }),
  );

  const scope1Total = sumByScope(currentRows, 'scope1');
  const scope2Total = sumByScope(currentRows, 'scope2');
  const previousScope1 = sumByScope(previousRows, 'scope1');
  const previousScope2 = sumByScope(previousRows, 'scope2');
  const combinedTotal = scope1Total + scope2Total;
  const previousCombined = previousScope1 + previousScope2;

  return {
    scope1Total,
    scope2Total,
    combinedTotal,
    scope1DiffPercent: calculateDiffPercent(scope1Total, previousScope1),
    scope2DiffPercent: calculateDiffPercent(scope2Total, previousScope2),
    totalDiffPercent: calculateDiffPercent(combinedTotal, previousCombined),
    monthlyData,
  };
};

/** dashboard_location_emissions_by_scope RPC の1行（拠点 × Scope の排出量合計）。 */
export type LocationScopeEmissionRow = {
  locationId: string;
  /** 拠点名。RLS で locations 行が不可視の場合は null（表示側でフォールバックする） */
  name: string | null;
  /** locations.region の enum 値（'kanto' など）。locations が不可視なら null */
  region: string | null;
  /** locations.type の enum 値（'factory' など）。locations が不可視なら null */
  type: string | null;
  scope: 'scope1' | 'scope2';
  /** 排出量合計（numeric(15,3)）。supabase-js からは string で返ることがある */
  emissions: number | string;
};

/** 上位拠点テーブルの1行（Scope 内訳と前年比つき）。 */
export type DashboardTopLocationDetail = {
  locationId: string;
  name: string;
  region: string | null;
  type: string | null;
  scope1: number;
  scope2: number;
  total: number;
  /** 前年同期比（%）。前年度に同拠点のデータが無い場合は null */
  diffPercent: number | null;
};

const sumByLocation = (rows: LocationScopeEmissionRow[]) => {
  const byLocation = new Map<string, { name: string | null; region: string | null; type: string | null; scope1: number; scope2: number }>();

  rows.forEach(row => {
    const entry = byLocation.get(row.locationId) ?? {
      name: row.name,
      region: row.region,
      type: row.type,
      scope1: 0,
      scope2: 0,
    };
    entry[row.scope] += toNumber(row.emissions);
    // 拠点名・地域・種別は同じ拠点のどの行にも同じ値が入るが、
    // 先に空行が来た場合に備えて値のあるほうを採用する。
    entry.name = entry.name ?? row.name;
    entry.region = entry.region ?? row.region;
    entry.type = entry.type ?? row.type;
    byLocation.set(row.locationId, entry);
  });

  return byLocation;
};

/**
 * 上位拠点テーブル（Scope 1 / Scope 2 の内訳・地域/種別・前年比つき）。
 * 並べ替えと件数の制限は取得層に依存させず、ここで行う。
 */
export const buildTopLocationDetails = (
  currentRows: LocationScopeEmissionRow[],
  previousRows: LocationScopeEmissionRow[],
  limit = 5,
): DashboardTopLocationDetail[] => {
  const current = sumByLocation(currentRows);
  const previous = sumByLocation(previousRows);

  return [...current.entries()]
    .map(([locationId, entry]) => {
      const previousEntry = previous.get(locationId);
      const previousTotal = previousEntry ? previousEntry.scope1 + previousEntry.scope2 : 0;
      const total = entry.scope1 + entry.scope2;
      return {
        locationId,
        name: entry.name ?? '名称未設定の拠点',
        region: entry.region,
        type: entry.type,
        scope1: entry.scope1,
        scope2: entry.scope2,
        total,
        diffPercent: calculateDiffPercent(total, previousTotal),
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
};

// =========================================================================
// Scope 3 内訳（dashboard_scope3_category_emissions RPC の行 → 表示用の内訳）
// =========================================================================

/** dashboard_scope3_category_emissions RPC の1行（カテゴリ × 方式適用後の採用値）。 */
export type Scope3CategoryEmissionRow = {
  categoryId: number;
  /** 採用値（numeric）。supabase-js からは string で返ることがある */
  emissions: number | string;
};

/**
 * dashboard_aggregates（算定確定時の権威値）がまだ無い年度向けの年度総排出量フォールバック。
 * Scope 1/2 は月別 RPC（活動量由来）から、Scope 3 は dashboard_scope3_category_emissions
 * （方式適用後の採用値）から合算する。
 *
 * 月別 RPC の Scope 3 行を使わないのは、直接入力方式（direct）のカテゴリに月別内訳が無く
 * 月別 RPC に現れないため。月別 RPC だけで合計すると、集計行ができた瞬間に
 * 削減目標の分母（基準年度実績）が変わってしまう。採用値を足せば合計は
 * scope1Total + scope2Total + scope3Total（refresh_dashboard_aggregates）と同じ定義になる。
 */
export const sumFallbackFiscalYearTotal = (
  monthlyRows: MonthlyEmissionRow[],
  scope3Rows: Scope3CategoryEmissionRow[],
): number => {
  const scope12 = monthlyRows
    .filter(row => row.scope !== 'scope3')
    .reduce((sum, row) => sum + toNumber(row.emissions), 0);
  return scope12 + sumScope3CategoryEmissions(scope3Rows);
};

/** Scope 3 カテゴリ別採用値の合計（内訳バーの「計」と同じ定義）。 */
export const sumScope3CategoryEmissions = (rows: Scope3CategoryEmissionRow[]): number =>
  rows.reduce((sum, row) => sum + toNumber(row.emissions), 0);

export type DashboardScope3Item = {
  categoryId: number;
  name: string;
  value: number;
  percent: number;
};

const SCOPE3_CATEGORY_LABELS: Record<number, string> = {
  1: 'カテゴリ1: 購入した製品・サービス',
  2: 'カテゴリ2: 資本財',
  3: 'カテゴリ3: Scope 1,2に含まれない燃料...',
  4: 'カテゴリ4: 輸送、配送（上流）',
  5: 'カテゴリ5: 事業から出る廃棄物',
  6: 'カテゴリ6: 出張',
  7: 'カテゴリ7: 雇用者の通勤',
  8: 'カテゴリ8: リース資産（上流）',
  9: 'カテゴリ9: 輸送、配送（下流）',
  10: 'カテゴリ10: 販売した製品の加工',
  11: 'カテゴリ11: 販売した製品の使用',
  12: 'カテゴリ12: 販売した製品の廃棄',
  13: 'カテゴリ13: リース資産（下流）',
  14: 'カテゴリ14: フランチャイズ',
  15: 'カテゴリ15: 投資',
};

// 内訳バーのスライスは「方式適用後の採用値」。RPC が refresh_dashboard_aggregates と同一の
// 採用ロジックで返すため、ここでの合計は表示側が見出しに出す
// dashboard_aggregates.scope3Total と一致する。方式切替があるため
// scope3_category_emissions を直読みすると一致しない。
export const buildScope3PieData = (rows: Scope3CategoryEmissionRow[]): DashboardScope3Item[] => {
  const total = rows.reduce((sum, row) => sum + toNumber(row.emissions), 0);
  if (total === 0) return [];

  return rows.map(row => {
    const value = toNumber(row.emissions);
    return {
      categoryId: row.categoryId,
      name: SCOPE3_CATEGORY_LABELS[row.categoryId] ?? `カテゴリ${row.categoryId}`,
      value,
      percent: (value / total) * 100,
    };
  });
};

// =========================================================================
// 年度別推移（月別グラフの「年度」表示）
// =========================================================================

/** 年度別グラフの1点（1会計年度ぶんの Scope 別合計）。 */
export type DashboardYearlyPoint = {
  fiscalYearId: string;
  /** 年度の開始年（例: 2026）。削減目標（年度ごとの削減率）との突き合わせに使う */
  year: number;
  /** X軸ラベル（年度ラベル。例: 2026年度） */
  name: string;
  scope1: number;
  scope2: number;
  scope3: number;
};

/** 年度別グラフに並べる会計年度（FiscalYearContext の選択肢と互換）。 */
export type FiscalYearBucket = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

/** dashboard_aggregates の1行（年度 × Scope の確定合計）。 */
export type FiscalYearAggregateRow = {
  fiscalYearId: string;
  scope1Total: number | string;
  scope2Total: number | string;
  scope3Total: number | string;
};

export type DashboardSummaryItem = {
  title: '総排出量' | 'Scope 1' | 'Scope 2' | 'Scope 3';
  value: number;
  diffPercent: number | null;
};

/**
 * KPI カード（総排出量 + Scope 1/2/3）の値と前年比。
 *
 * Scope 1/2 は dashboard_aggregates（算定確定時の権威値）から取る。
 * Scope 3 だけは集計行の scope3Total ではなく、内訳バーと同じカテゴリ別採用値
 * （dashboard_scope3_category_emissions）の合計から導く。
 * scope3Total は Scope 3 の保存後に別 API（/api/dashboard-aggregates/refresh）で更新されるため、
 * その更新だけが失敗すると「見出し・KPI は 0（または古い値）なのに内訳バーには実数値」という
 * 同一画面内の矛盾になる。採用値 RPC は scope3Total と同一の式で返る（§5.1）ので、
 * 同じ行列から足せば KPI・見出し・内訳バーが定義上一致し、集計行の欠落・失効に左右されない。
 * 総排出量も同じ Scope 3 値で合算し、カード間で食い違わないようにする。
 */
export const buildDashboardSummary = (
  currentAggregate: FiscalYearAggregateRow | null,
  previousAggregate: FiscalYearAggregateRow | null,
  currentScope3Rows: Scope3CategoryEmissionRow[],
  previousScope3Rows: Scope3CategoryEmissionRow[],
): DashboardSummaryItem[] => {
  const current = {
    scope1: toNumber(currentAggregate?.scope1Total),
    scope2: toNumber(currentAggregate?.scope2Total),
    scope3: sumScope3CategoryEmissions(currentScope3Rows),
  };
  const previous = {
    scope1: toNumber(previousAggregate?.scope1Total),
    scope2: toNumber(previousAggregate?.scope2Total),
    scope3: sumScope3CategoryEmissions(previousScope3Rows),
  };
  const currentTotal = current.scope1 + current.scope2 + current.scope3;
  const previousTotal = previous.scope1 + previous.scope2 + previous.scope3;

  return [
    { title: '総排出量', value: currentTotal, diffPercent: calculateDiffPercent(currentTotal, previousTotal) },
    { title: 'Scope 1', value: current.scope1, diffPercent: calculateDiffPercent(current.scope1, previous.scope1) },
    { title: 'Scope 2', value: current.scope2, diffPercent: calculateDiffPercent(current.scope2, previous.scope2) },
    { title: 'Scope 3', value: current.scope3, diffPercent: calculateDiffPercent(current.scope3, previous.scope3) },
  ];
};

// グラフは古い年度から新しい年度へ左→右に並べる（年度セレクタは降順で持っているため並べ替える）。
const sortByStartDate = (fiscalYears: FiscalYearBucket[]): FiscalYearBucket[] =>
  [...fiscalYears].sort((a, b) => a.startDate.localeCompare(b.startDate));

// 組織全体の年度別推移。値は dashboard_aggregates（算定確定時の権威値）を使うため、
// KPI カード・削減目標カードと数字が食い違わない。集計行が無い年度は 0 のまま並べて、
// 「まだ算定していない年度」も横並びで見えるようにする。
export const buildYearlyEmissionData = (
  fiscalYears: FiscalYearBucket[],
  rows: FiscalYearAggregateRow[],
): DashboardYearlyPoint[] => {
  const byFiscalYear = new Map(rows.map(row => [row.fiscalYearId, row]));

  return sortByStartDate(fiscalYears).map(fiscalYear => {
    const row = byFiscalYear.get(fiscalYear.id);
    return {
      fiscalYearId: fiscalYear.id,
      year: Number(fiscalYear.startDate.slice(0, 4)),
      name: fiscalYear.label,
      scope1: toNumber(row?.scope1Total),
      scope2: toNumber(row?.scope2Total),
      scope3: toNumber(row?.scope3Total),
    };
  });
};

// 拠点絞り込み中の年度別推移。拠点別に持てるのは活動量由来の Scope 1/2 だけのため、
// 全年度ぶんの月別集計行（dashboard_monthly_emissions を全期間で1回呼んだ結果）を
// 年度期間で振り分けて合計する。Scope 3 は常に 0（表示側で系列ごと出さない）。
export const buildLocationYearlyEmissionData = (
  fiscalYears: FiscalYearBucket[],
  rows: MonthlyEmissionRow[],
): DashboardYearlyPoint[] =>
  sortByStartDate(fiscalYears).map(fiscalYear => {
    // monthStart / startDate / endDate はいずれも 'YYYY-MM-DD' 固定長のため文字列比較で判定できる。
    const yearRows = rows.filter(
      row => row.monthStart >= fiscalYear.startDate && row.monthStart <= fiscalYear.endDate,
    );
    return {
      fiscalYearId: fiscalYear.id,
      year: Number(fiscalYear.startDate.slice(0, 4)),
      name: fiscalYear.label,
      scope1: sumByScope(yearRows, 'scope1'),
      scope2: sumByScope(yearRows, 'scope2'),
      scope3: 0,
    };
  });
