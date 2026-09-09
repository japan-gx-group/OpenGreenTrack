// 会計年度行（fiscal_years）の解決を1か所へ集約する。
//
// 期首月は組織ごとに違うため「年度＝4月始まり」で期間を決め打ちできない。画面が選択中の
// 年度ID（FiscalYearContext）を正として期間を引き、無い場合だけ「開始日の暦年」で引く。
// ラベル（例: '2026年度'）の前方一致では引かない。ラベルは表記ゆれ（'2024年度（検証用）' /
// 'FY2024' など）があり得て、ゆれた瞬間に年度が引けず画面ごとエラーになるため。
//
// 候補（candidates）を複数返すのは、同じ期間の年度行が複数存在し得るため。
//
// グループ会社（サブカンパニー）の概念は現スキーマには存在せず、fiscal_years の RLS
// （fiscal_years_select_own_organization）は自組織の行しか返さない。そのためこの関数が
// クロス組織の候補を返すことはない。
//
// それでも候補を複数返す実装を残しているのは、同一組織内に同じ期間の年度行が重複登録され得るため
// （fiscal_years に期間の一意制約は無い）。重複年度を許さない方針にするなら、この候補解決一式と
// dashboardService.findOrgFiscalYear は削除できる（要プロダクト判断）。

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseFiscalYearStartYear, type FiscalYearDateRange } from './fiscalYearPeriod';

export type FiscalYearLookupRow = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  // 候補行の所有組織。Scope分析の方式管理で、書き込み（方式切替・直接入力の upsert）を
  // 自組織の年度行に限る判定に使う。グループ会社削除後は fiscal_years の RLS が
  // 自組織の行しか返さないため実質的に常に一致するが、RLS 単独に依存しない多層防御として残す。
  organizationId: string | null;
};

const FISCAL_YEAR_COLUMNS = 'id, label, startDate, endDate, organizationId';

const fiscalYearNotFound = (fiscalYear: string): Error =>
  new Error(`算定年度（${fiscalYear}年度）が見つかりません`);

/** 選択中の行を先頭に固定したまま、同じ期間の他の年度行を候補へ連結する。 */
export const orderCandidatesFromAnchor = (
  anchor: FiscalYearLookupRow,
  rows: FiscalYearLookupRow[],
): FiscalYearLookupRow[] => [anchor, ...rows.filter(row => row.id !== anchor.id)];

/** 同じ暦年でも期間が異なる行（期首月変更後に増えた行など）を除き、anchor と同じ期間だけ残す。 */
export const filterSamePeriod = (
  anchor: FiscalYearDateRange,
  rows: FiscalYearLookupRow[],
): FiscalYearLookupRow[] =>
  rows.filter(row => row.startDate === anchor.startDate && row.endDate === anchor.endDate);

/**
 * 年度行を「開始日の暦年 → 期間」へまとめる。
 * preferredStartMonth と同じ月に始まる行を優先する。期首月を変更した組織では同じ暦年に
 * 期首月の異なる年度行が共存し得るため（fiscal_years に期間の一意制約は無い）、
 * 選択中の年度と同じ期首月の行を選ぶ。
 */
export const groupPeriodsByStartYear = (
  rows: FiscalYearLookupRow[],
  preferredStartMonth?: number,
): Map<number, FiscalYearDateRange> => {
  const preferred = new Map<number, FiscalYearDateRange>();
  const fallback = new Map<number, FiscalYearDateRange>();

  rows.forEach(row => {
    const startYear = Number(row.startDate.slice(0, 4));
    if (!Number.isInteger(startYear)) return;

    const matchesPreferred = Number(row.startDate.slice(5, 7)) === preferredStartMonth;
    const target = matchesPreferred ? preferred : fallback;
    if (target.has(startYear)) return;
    target.set(startYear, { startDate: row.startDate, endDate: row.endDate });
  });

  return new Map([...fallback, ...preferred]);
};

const fetchById = async (
  supabase: SupabaseClient,
  id: string,
): Promise<FiscalYearLookupRow | null> => {
  const { data, error } = await supabase
    .from('fiscal_years')
    .select(FISCAL_YEAR_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error('算定年度の取得に失敗しました');
  }
  return (data as FiscalYearLookupRow | null) ?? null;
};

const fetchByStartYearRange = async (
  supabase: SupabaseClient,
  fromYear: number,
  toYear: number,
): Promise<FiscalYearLookupRow[]> => {
  const { data, error } = await supabase
    .from('fiscal_years')
    .select(FISCAL_YEAR_COLUMNS)
    .gte('startDate', `${fromYear}-01-01`)
    .lt('startDate', `${toYear + 1}-01-01`)
    // 既定候補の優先順（作成が古い順）。先頭がその年度の代表行になる。
    .order('createdAt', { ascending: true });

  if (error) {
    throw new Error('算定年度の取得に失敗しました');
  }
  return (data ?? []) as FiscalYearLookupRow[];
};

const fetchSamePeriod = async (
  supabase: SupabaseClient,
  period: FiscalYearDateRange,
): Promise<FiscalYearLookupRow[]> => {
  const { data, error } = await supabase
    .from('fiscal_years')
    .select(FISCAL_YEAR_COLUMNS)
    .eq('startDate', period.startDate)
    .eq('endDate', period.endDate)
    .order('createdAt', { ascending: true });

  if (error) {
    throw new Error('算定年度の取得に失敗しました');
  }
  return (data ?? []) as FiscalYearLookupRow[];
};

/**
 * 選択年度と同じ期間を持つ年度行の候補を返す（候補[0] が代表行）。
 * preferredFiscalYearId（画面で選択中の年度ID）があればそれを代表行にする。
 * 1件も見つからない場合は throw する。
 */
export const resolveFiscalYearCandidates = async (
  supabase: SupabaseClient,
  fiscalYear: string,
  preferredFiscalYearId?: string | null,
): Promise<FiscalYearLookupRow[]> => {
  const preferred = preferredFiscalYearId ? await fetchById(supabase, preferredFiscalYearId) : null;
  if (preferred) {
    return orderCandidatesFromAnchor(preferred, await fetchSamePeriod(supabase, preferred));
  }

  const startYear = parseFiscalYearStartYear(fiscalYear);
  const rows = await fetchByStartYearRange(supabase, startYear, startYear);
  const anchor = rows[0];
  if (!anchor) {
    throw fiscalYearNotFound(fiscalYear);
  }
  return orderCandidatesFromAnchor(anchor, filterSamePeriod(anchor, rows));
};

/**
 * 選択年度の期間だけが必要な画面向け（候補IDを使わないぶんクエリ1回で済む）。
 * 1件も見つからない場合は throw する。
 */
export const resolveFiscalYearDateRange = async (
  supabase: SupabaseClient,
  fiscalYear: string,
  preferredFiscalYearId?: string | null,
): Promise<FiscalYearDateRange> => {
  const preferred = preferredFiscalYearId ? await fetchById(supabase, preferredFiscalYearId) : null;
  if (preferred) {
    return { startDate: preferred.startDate, endDate: preferred.endDate };
  }

  const startYear = parseFiscalYearStartYear(fiscalYear);
  const [anchor] = await fetchByStartYearRange(supabase, startYear, startYear);
  if (!anchor) {
    throw fiscalYearNotFound(fiscalYear);
  }
  return { startDate: anchor.startDate, endDate: anchor.endDate };
};
