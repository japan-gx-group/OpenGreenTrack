import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { resolveFiscalYearCandidates } from '@/lib/fiscal-year/fiscalYearLookup';

type Scope3CategoryEmissionRow = {
  fiscalYearId: string;
  categoryId: number;
  emissions: number | string;
  dataSourceNote?: string | null;
};

type SupplierEmbed = {
  id: string;
  name: string;
  primaryDataRate: number | string;
};

// supabase-js は生成型なしだと埋め込み（suppliers(...)）を配列として推論するが、
// supplierId は多対一FKのため PostgREST の実レスポンスは単一オブジェクト。
// 型のズレを吸収するため、取得直後に配列/オブジェクトの両方を許容する生の型で受け、
// 単一オブジェクトへ正規化してから利用する。
type SupplierEmissionRawRow = {
  id: string;
  fiscalYearId: string;
  categoryId: number;
  emissions: number | string;
  suppliers: SupplierEmbed | SupplierEmbed[] | null;
};

// suppliers を単一オブジェクト（自組織で不可視なら null）に正規化した行。
type SupplierEmissionRow = {
  id: string;
  fiscalYearId: string;
  categoryId: number;
  emissions: number | string;
  suppliers: SupplierEmbed | null;
};

export type Scope3CategoryItem = {
  id: number;
  name: string;
  displayName?: string;
  value: string;
  percentage: string;
  emissions: number;
};

export type Scope3SupplierItem = {
  id: string;
  name: string;
  categoryId: number;
  category: string;
  emissions: string;
  emissionsNum: number;
  rate: number;
};

// Scope3 カテゴリの算定方法（docs/idea-scope3-spec.md §5.1）。
// scope3_category_methods に行が無いカテゴリ×年度の既定は 'direct'（後方互換）。
export type Scope3Method = 'direct' | 'calculated';

export type Scope3CategoryMethodRow = {
  fiscalYearId: string;
  categoryId: number;
  method: Scope3Method;
};

// カテゴリ1〜15の方式・直接入力値・積上げ算定値・採用値をまとめた行（方式管理テーブル用）。
export type Scope3MethodCategoryItem = {
  categoryId: number;
  name: string;
  method: Scope3Method;
  /** scope3_category_emissions の直接入力値。未登録は null（0 とは区別する） */
  directEmissions: number | null;
  /** 直接入力値のデータソースメモ（編集フォームの初期値用） */
  directDataSourceNote: string | null;
  /** emission_results（scope='scope3'・当該カテゴリ・年度期間内）の積上げ算定合計 */
  calculatedEmissions: number;
  /** 方式に応じて scope3Total へ算入される値（refresh_dashboard_aggregates と同ロジック） */
  adoptedEmissions: number;
};

/** Scope 別構成カード用の年度合計（dashboard_aggregates 由来＝ダッシュボードと同じ正本）。 */
export type ScopeTotals = {
  scope1: number;
  scope2: number;
  scope3: number;
  total: number;
};

export type ScopeAnalysisData = {
  categories: Scope3CategoryItem[];
  /** Scope 1・2・3 の年度合計。集計行が無い年度は全て 0 */
  scopeTotals: ScopeTotals;
  suppliers: Scope3SupplierItem[];
  // 方式管理テーブル用のカテゴリ別明細と、書き込み・再集計に使う年度ID。
  methodItems: Scope3MethodCategoryItem[];
  /** 表示・書き込み対象に選ばれた年度行のID（方式切替・直接入力 upsert・再集計に使う） */
  fiscalYearId: string;
};

// Scope3 カテゴリ（1〜15）の正式名称。データ入力の Scope3 積上げモードの
// カテゴリ選択・履歴表示でも再利用するため export する。
export const SCOPE3_CATEGORY_NAMES: Record<number, string> = {
  1: '購入した製品・サービス',
  2: '資本財',
  3: 'Scope 1,2 に含まれない燃料及びエネルギー',
  4: '輸送、配送（上流）',
  5: '事業から出る廃棄物',
  6: '出張',
  7: '雇用者の通勤',
  8: 'リース資産（上流）',
  9: '輸送、配送（下流）',
  10: '販売した製品の加工',
  11: '販売した製品の使用',
  12: '販売した製品の廃棄',
  13: 'リース資産（下流）',
  14: 'フランチャイズ',
  15: '投資',
};

export const SCOPE3_CATEGORY_IDS: number[] = Array.from({ length: 15 }, (_, index) => index + 1);

const CATEGORY_DISPLAY_LABELS: Record<number, string> = {
  3: 'Scope 1,2 に含まれない燃料...',
};

const toNumber = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

// PostgREST の max_rows（supabase/config.toml で 1000）で黙って切り詰められるのを防ぐため、
// range() でページングしながら全行を取得する（dashboardService と同じ定石）。
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

const fetchAllRows = async <T>(
  runPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  errorMessage: string,
): Promise<T[]> => {
  const allRows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await runPage(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(errorMessage);
    }
    const rows = data ?? [];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return allRows;
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 }).format(value);

const formatSupplierCategory = (categoryId: number): string =>
  `${categoryId}. ${SCOPE3_CATEGORY_NAMES[categoryId] ?? `カテゴリ${categoryId}`}`;

const getScope3CategoryEmissions = async (
  supabase: SupabaseClient,
  fiscalYearIds: string[],
): Promise<Scope3CategoryEmissionRow[]> => {
  if (fiscalYearIds.length === 0) return [];

  const { data, error } = await supabase
    .from('scope3_category_emissions')
    .select('fiscalYearId, categoryId, emissions, dataSourceNote')
    .in('fiscalYearId', fiscalYearIds)
    .order('categoryId', { ascending: true });

  if (error) {
    throw new Error('Scope 3カテゴリ別排出量の取得に失敗しました');
  }

  return (data ?? []) as Scope3CategoryEmissionRow[];
};

// カテゴリ別の算定方法（scope3_category_methods）。RLS は自組織のみのため、
// 候補年度IDで引いても自組織の設定行しか返らない。
const getScope3CategoryMethods = async (
  supabase: SupabaseClient,
  fiscalYearIds: string[],
): Promise<Scope3CategoryMethodRow[]> => {
  if (fiscalYearIds.length === 0) return [];

  const { data, error } = await supabase
    .from('scope3_category_methods')
    .select('fiscalYearId, categoryId, method')
    .in('fiscalYearId', fiscalYearIds);

  if (error) {
    throw new Error('Scope 3 の算定方法の取得に失敗しました');
  }

  return (data ?? []) as Scope3CategoryMethodRow[];
};

type CalculatedEmissionRow = {
  categoryId: number | null;
  emissions: number | string;
};

// 積上げ算定（emission_results の scope3 行）のカテゴリ別合計。
// 年度帰属は activity_records.periodStart 基準（refresh_dashboard_aggregates と同一）。
// 集計に必要な2列のみ取得し、明細全列のクライアント取得は行わない。
// scope3 行は自組織限定 RLS（supabase/migrations/20260831000001_rls.sql の
// emission_results_select_own_organization。IDEAライセンス境界）のため組織絞り込みは不要。
const getScope3CalculatedEmissions = async (
  supabase: SupabaseClient,
  period: { startDate: string; endDate: string },
): Promise<CalculatedEmissionRow[]> =>
  fetchAllRows<CalculatedEmissionRow>(
    (from, to) =>
      supabase
        .from('emission_results')
        .select('categoryId, emissions, activity_records!inner(periodStart)')
        .eq('scope', 'scope3')
        .gte('activity_records.periodStart', period.startDate)
        .lte('activity_records.periodStart', period.endDate)
        .order('id', { ascending: true })
        .range(from, to),
    'Scope 3積上げ算定結果の取得に失敗しました',
  );

/** 積上げ算定行をカテゴリ別合計へ集約する（カテゴリ1〜15以外・null は無視）。 */
export const sumCalculatedByCategory = (rows: CalculatedEmissionRow[]): Map<number, number> => {
  const totals = new Map<number, number>();
  for (const row of rows) {
    const categoryId = row.categoryId;
    if (typeof categoryId !== 'number' || categoryId < 1 || categoryId > 15) continue;
    totals.set(categoryId, (totals.get(categoryId) ?? 0) + toNumber(row.emissions));
  }
  return totals;
};

// サプライヤー別Scope3実排出量（supplier_emissions）を対象年度候補で取得する。
// suppliers を埋め込み結合し、サプライヤー名・1次データ取得率を同時に得る。
const getSupplierEmissions = async (
  supabase: SupabaseClient,
  fiscalYearIds: string[],
): Promise<SupplierEmissionRow[]> => {
  if (fiscalYearIds.length === 0) return [];

  const rawRows = await fetchAllRows<SupplierEmissionRawRow>(
    (from, to) =>
      supabase
        .from('supplier_emissions')
        .select('id, fiscalYearId, categoryId, emissions, suppliers(id, name, primaryDataRate)')
        .in('fiscalYearId', fiscalYearIds)
        .order('id', { ascending: true })
        .range(from, to),
    'サプライヤー別排出量の取得に失敗しました',
  );

  return rawRows.map(row => ({
    ...row,
    suppliers: Array.isArray(row.suppliers) ? (row.suppliers[0] ?? null) : row.suppliers,
  }));
};

// 入力は「カテゴリID＋排出量」に一般化してある。direct 行と方式別の採用値のどちらからでも
// 組み立てられ、scope3_category_emissions の行もそのまま渡せる。
export const buildCategories = (
  rows: { categoryId: number; emissions: number | string }[],
): Scope3CategoryItem[] => {
  const total = rows.reduce((sum, row) => sum + toNumber(row.emissions), 0);

  return rows
    .map(row => {
      const emissions = toNumber(row.emissions);

      return {
        id: row.categoryId,
        name: SCOPE3_CATEGORY_NAMES[row.categoryId] ?? `カテゴリ${row.categoryId}`,
        displayName: CATEGORY_DISPLAY_LABELS[row.categoryId],
        value: formatNumber(emissions),
        percentage: total > 0 ? `${((emissions / total) * 100).toFixed(1)}%` : '0.0%',
        emissions,
      };
    })
    .sort((a, b) => b.emissions - a.emissions);
};

// supplier_emissions の実排出量からサプライヤー一覧を組み立てる。
// 按分は行わず、その年度に実績レコードがあるサプライヤー（＝行）だけを排出量降順で返す。
export const buildSuppliers = (rows: SupplierEmissionRow[]): Scope3SupplierItem[] =>
  rows
    // suppliers が null の行（結合先が消えた/他組織で不可視 等）は表示対象外にする。
    .filter((row): row is SupplierEmissionRow & { suppliers: NonNullable<SupplierEmissionRow['suppliers']> } =>
      row.suppliers !== null,
    )
    .map(row => {
      const emissions = toNumber(row.emissions);

      return {
        // supplier_emissions の行ID。同一サプライヤーが複数カテゴリに出る場合でも一意なキーになる。
        id: row.id,
        name: row.suppliers.name,
        categoryId: row.categoryId,
        category: formatSupplierCategory(row.categoryId),
        emissions: formatNumber(emissions),
        emissionsNum: emissions,
        rate: Math.round(toNumber(row.suppliers.primaryDataRate)),
      };
    })
    .sort((a, b) => b.emissionsNum - a.emissionsNum);

/**
 * カテゴリ1〜15の方式管理テーブル行を組み立てる（refresh_dashboard_aggregates §5.1 と
 * 同じ採用ロジック: 方式未設定は 'direct'、direct → 直接入力値 / calculated → 積上げ合計）。
 * 'calculated' 採用中でも直接入力値は保持して返す（画面で「未採用」表示。切替の可逆性）。
 */
export const buildMethodItems = (input: {
  methodRows: Pick<Scope3CategoryMethodRow, 'categoryId' | 'method'>[];
  directRows: { categoryId: number; emissions: number | string; dataSourceNote?: string | null }[];
  calculatedByCategory: Map<number, number>;
}): Scope3MethodCategoryItem[] => {
  const methodByCategory = new Map(input.methodRows.map(row => [row.categoryId, row.method]));
  const directByCategory = new Map(input.directRows.map(row => [row.categoryId, row]));

  return SCOPE3_CATEGORY_IDS.map(categoryId => {
    const method = methodByCategory.get(categoryId) ?? 'direct';
    const directRow = directByCategory.get(categoryId);
    const directEmissions = directRow ? toNumber(directRow.emissions) : null;
    const calculatedEmissions = input.calculatedByCategory.get(categoryId) ?? 0;

    return {
      categoryId,
      name: SCOPE3_CATEGORY_NAMES[categoryId] ?? `カテゴリ${categoryId}`,
      method,
      directEmissions,
      directDataSourceNote: directRow?.dataSourceNote ?? null,
      calculatedEmissions,
      adoptedEmissions: method === 'calculated' ? calculatedEmissions : (directEmissions ?? 0),
    };
  });
};

// Scope 別構成カード用の年度合計。ダッシュボードの KPI と同じ dashboard_aggregates を読み、
// 画面間で Scope 1/2/3 の数字が食い違わないようにする。集計行が無い年度は 0 に倒す。
const getScopeTotals = async (
  supabase: SupabaseClient,
  fiscalYearId: string,
): Promise<ScopeTotals> => {
  const { data } = await supabase
    .from('dashboard_aggregates')
    .select('scope1Total, scope2Total, scope3Total')
    .eq('fiscalYearId', fiscalYearId)
    .maybeSingle();

  const row = data as { scope1Total: number | string; scope2Total: number | string; scope3Total: number | string } | null;
  const scope1 = Number(row?.scope1Total ?? 0) || 0;
  const scope2 = Number(row?.scope2Total ?? 0) || 0;
  const scope3 = Number(row?.scope3Total ?? 0) || 0;
  return { scope1, scope2, scope3, total: scope1 + scope2 + scope3 };
};

export const getScopeAnalysisData = async (
  fiscalYear: string,
  fiscalYearId?: string | null,
): Promise<ScopeAnalysisData> => {
  const supabase = createClient();
  const fiscalYearCandidates = await resolveFiscalYearCandidates(supabase, fiscalYear, fiscalYearId);
  const fiscalYearIds = fiscalYearCandidates.map(candidate => candidate.id);
  const [categoryEmissions, supplierEmissions, methodRows] = await Promise.all([
    getScope3CategoryEmissions(supabase, fiscalYearIds),
    getSupplierEmissions(supabase, fiscalYearIds),
    getScope3CategoryMethods(supabase, fiscalYearIds),
  ]);
  // 表示・書き込み対象の年度行: 直接入力値または方式設定を持つ候補を優先し、無ければ先頭
  // （選択中の年度）。方式設定（scope3_category_methods）は自組織の行しか見えないため、
  // 方式だけ設定済みのケースでも自組織の年度行が選ばれる。
  const selectedFiscalYear =
    fiscalYearCandidates.find(candidate =>
      categoryEmissions.some(row => row.fiscalYearId === candidate.id) ||
      methodRows.some(row => row.fiscalYearId === candidate.id),
    ) ?? fiscalYearCandidates[0];

  const categoryEmissionsForFiscalYear = categoryEmissions.filter(row => row.fiscalYearId === selectedFiscalYear.id);
  const supplierEmissionsForFiscalYear = supplierEmissions.filter(row => row.fiscalYearId === selectedFiscalYear.id);
  const methodRowsForFiscalYear = methodRows.filter(row => row.fiscalYearId === selectedFiscalYear.id);

  // 積上げ算定合計（自組織の scope3 算定結果のみ。RLS で他組織行は不可視）。
  const calculatedRows = await getScope3CalculatedEmissions(supabase, {
    startDate: selectedFiscalYear.startDate,
    endDate: selectedFiscalYear.endDate,
  });

  const methodItems = buildMethodItems({
    methodRows: methodRowsForFiscalYear,
    directRows: categoryEmissionsForFiscalYear,
    calculatedByCategory: sumCalculatedByCategory(calculatedRows),
  });

  const scopeTotals = await getScopeTotals(supabase, selectedFiscalYear.id);

  return {
    scopeTotals,
    // ドーナツ・レポートのカテゴリ別内訳は「採用値」（方式適用後）で組み立てる。
    // scope3Total（refresh_dashboard_aggregates）と同じ値になり、集計ドリフトしない。
    categories: buildCategories(
      methodItems
        .filter(item => item.adoptedEmissions > 0)
        .map(item => ({ categoryId: item.categoryId, emissions: item.adoptedEmissions })),
    ),
    suppliers: buildSuppliers(supplierEmissionsForFiscalYear),
    methodItems,
    fiscalYearId: selectedFiscalYear.id,
  };
};

// =========================================================================
// 積上げカテゴリの製品別ドリルダウン（docs/idea-scope3-spec.md §5.2）
// =========================================================================

/** ドリルダウン1行（製品別の集計値）。 */
export type Scope3DrilldownProduct = {
  /** 集計キー（ideaFactorId または名称スナップショット）。React の key 用 */
  key: string;
  productName: string;
  /** 活動量の単位（同一製品で単位が混在した場合は null にして合計を出さない） */
  unit: string | null;
  /** 活動量の合計。unit が null の場合は null */
  totalAmount: number | null;
  totalEmissions: number;
  percentage: string;
};

export type Scope3CategoryDrilldown = {
  /** 排出量降順の上位製品 ＋ 残りをまとめた「その他」行 */
  products: Scope3DrilldownProduct[];
  totalEmissions: number;
  /** 集計対象の製品数（「その他」へ畳んだ分を含む） */
  productCount: number;
};

type DrilldownRawRow = {
  emissions: number | string;
  ideaFactorId: string | null;
  appliedFactorName: string | null;
  idea_factors: { productName: string } | { productName: string }[] | null;
  activity_records: { amount: number | string; unit: string } | { amount: number | string; unit: string }[] | null;
};

/** ドリルダウンで表示する上位製品数。超過分は「その他」へまとめる。 */
export const DRILLDOWN_TOP_LIMIT = 10;

const toSingleEmbed = <T>(embed: T | T[] | null): T | null =>
  Array.isArray(embed) ? (embed[0] ?? null) : embed;

/**
 * 製品別ドリルダウン行の組み立て（純関数）。
 * 製品名は idea_factors の現在値を優先し、参照切れ（版削除）の行は算定時スナップショット
 * appliedFactorName（例 '999999999mJPN ダミー製品 (AIST-IDEA Ver.4.0)'）へフォールバックする。
 */
export const buildDrilldownProducts = (
  rows: DrilldownRawRow[],
  topLimit: number = DRILLDOWN_TOP_LIMIT,
): Scope3CategoryDrilldown => {
  type Aggregate = {
    key: string;
    productName: string;
    unit: string | null;
    totalAmount: number | null;
    totalEmissions: number;
  };
  const byProduct = new Map<string, Aggregate>();

  for (const row of rows) {
    const ideaFactor = toSingleEmbed(row.idea_factors);
    const activityRecord = toSingleEmbed(row.activity_records);
    const key = row.ideaFactorId ?? row.appliedFactorName ?? '（製品情報なし）';
    const productName = ideaFactor?.productName ?? row.appliedFactorName ?? '（製品情報なし）';
    const unit = activityRecord?.unit ?? null;
    const amount = activityRecord ? toNumber(activityRecord.amount) : null;

    const current = byProduct.get(key);
    if (!current) {
      byProduct.set(key, {
        key,
        productName,
        unit,
        totalAmount: amount,
        totalEmissions: toNumber(row.emissions),
      });
      continue;
    }

    current.totalEmissions += toNumber(row.emissions);
    if (current.unit !== unit) {
      // 単位が混在する場合は活動量の合計に意味が無いため出さない（排出量合計は有効）。
      current.unit = null;
      current.totalAmount = null;
    } else if (current.totalAmount !== null && amount !== null) {
      current.totalAmount += amount;
    }
  }

  const aggregates = [...byProduct.values()].sort((a, b) => b.totalEmissions - a.totalEmissions);
  const totalEmissions = aggregates.reduce((sum, item) => sum + item.totalEmissions, 0);
  const percentageOf = (value: number): string =>
    totalEmissions > 0 ? `${((value / totalEmissions) * 100).toFixed(1)}%` : '0.0%';

  const top = aggregates.slice(0, topLimit);
  const rest = aggregates.slice(topLimit);

  const products: Scope3DrilldownProduct[] = top.map(item => ({
    key: item.key,
    productName: item.productName,
    unit: item.unit,
    totalAmount: item.totalAmount,
    totalEmissions: item.totalEmissions,
    percentage: percentageOf(item.totalEmissions),
  }));

  if (rest.length > 0) {
    const restEmissions = rest.reduce((sum, item) => sum + item.totalEmissions, 0);
    products.push({
      key: '__others__',
      productName: `その他（${rest.length}製品）`,
      unit: null,
      totalAmount: null,
      totalEmissions: restEmissions,
      percentage: percentageOf(restEmissions),
    });
  }

  return { products, totalEmissions, productCount: aggregates.length };
};

/**
 * 積上げカテゴリの製品別内訳を取得する（展開時に遅延取得）。
 * 対象カテゴリの scope3 算定結果に列を絞ってページング取得し、クライアント側で
 * 製品別に集計して上位 DRILLDOWN_TOP_LIMIT 件＋「その他」を返す。
 */
export const getScope3CategoryDrilldown = async (
  fiscalYearId: string,
  categoryId: number,
): Promise<Scope3CategoryDrilldown> => {
  const supabase = createClient();

  const { data: fiscalYear, error: fiscalYearError } = await supabase
    .from('fiscal_years')
    .select('startDate, endDate')
    .eq('id', fiscalYearId)
    .maybeSingle();
  if (fiscalYearError || !fiscalYear) {
    throw new Error('算定年度の取得に失敗しました');
  }
  const period = fiscalYear as { startDate: string; endDate: string };

  const rows = await fetchAllRows<DrilldownRawRow>(
    (from, to) =>
      supabase
        .from('emission_results')
        .select(
          'emissions, ideaFactorId, appliedFactorName, idea_factors(productName), activity_records!inner(amount, unit, periodStart)',
        )
        .eq('scope', 'scope3')
        .eq('categoryId', categoryId)
        .gte('activity_records.periodStart', period.startDate)
        .lte('activity_records.periodStart', period.endDate)
        .order('id', { ascending: true })
        .range(from, to),
    '製品別内訳の取得に失敗しました',
  );

  return buildDrilldownProducts(rows);
};
