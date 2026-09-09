// KPI削減目標（reduction_targets）の取得・保存サービス。
// Supabase の reduction_targets / dashboard_aggregates への読み書きと、集計行が無い年度向けの
// フォールバック取得（dashboardService.getFallbackFiscalYearTotal）を行う
// （ブラウザ = Client Component からのみ呼ぶこと）。
// 目標は「基準年度（reduction_targets）+ 年度ごとの削減率（reduction_target_years）」で持ち、
// ある年度の年間目標排出量は「基準年度の実績 × (1 - その年度の削減率/100)」として
// 導出する（targetAggregation.ts 参照）。
//
// dashboardService.ts と異なり、呼び出し側（ダッシュボードの削減目標カード）は FiscalYearContext
// から既に確定した年度一覧（id・label・期間）を持っているため、年度ラベル文字列から候補行を
// 解決する処理（getFiscalYearCandidates 等）は不要。その分シンプルな実装にしている。
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { getFallbackFiscalYearTotal } from '@/features/dashboard/services/dashboardService';
import {
  buildAnnualProgress,
  buildTargetsByYear,
  getFiscalYearStartYearFromDate,
  toNumber,
  type AnnualProgress,
} from './targetAggregation';

type ReductionTargetRow = { baseFiscalYearId: string };
type ReductionTargetYearRow = {
  targetYear: number;
  reductionPercent: number | string;
};
type DashboardAggregateRow = {
  scope1Total: number | string;
  scope2Total: number | string;
  scope3Total: number | string;
};

/** 年度の期間解決に必要な最小限の年度情報（FiscalYearContext の選択肢と互換）。 */
export type FiscalYearRef = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

/** 年間実績・基準年度実績の出典。表示側で注記を切り替えるためのフラグ。 */
export type EmissionsSource = 'aggregate' | 'monthly';

// ログイン中ユーザーの所属組織ID。insert/upsert 時に組織を明示する必要がある
// （RLSのwith checkと一致させる。locationService.ts と同じパターン）。
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
  return data.organizationId as string;
};

// 年間実績のフォールバック値: dashboard_aggregates（算定確定時の権威値）がまだ無い年度でのみ使う。
//
// 活動量レコードと算定結果を全行取得してブラウザで合計するのではなく、DB 側で集約済みの行を
// 受け取って合算する。Scope 1/2 は月別×Scope の集約（dashboard_monthly_emissions、最大 12ヶ月×
// Scope 分）、Scope 3 はカテゴリ別の採用値（dashboard_scope3_category_emissions、最大 15 行）。
// 月別 RPC だけで合計すると直接入力方式の Scope 3（月別内訳なし）が抜け、集計行ができた時点で
// 基準年度の分母が変わってしまうため、Scope 3 は採用値 RPC から足す（合計の定義を
// dashboard_aggregates と揃える）。RLS は security invoker の関数内でそのまま効く。
const getFallbackAnnualActual = async (
  supabase: SupabaseClient,
  fiscalYearId: string,
  period: { startDate: string; endDate: string },
): Promise<number> => getFallbackFiscalYearTotal(supabase, fiscalYearId, period);

// 年度の総排出量（Scope 1〜3 合算）。dashboard_aggregates（算定確定時の権威値）を優先し、
// まだ算定が実行されておらず行が存在しない年度は期間内の算定結果の合算にフォールバックする。
// 表示中の年度の実績にも、削減率の分母になる基準年度の実績にも同じ定義を使う。
const getFiscalYearTotal = async (
  supabase: SupabaseClient,
  fiscalYearId: string,
  period: { startDate: string; endDate: string },
): Promise<{ total: number; source: EmissionsSource }> => {
  const { data, error } = await supabase
    .from('dashboard_aggregates')
    .select('scope1Total, scope2Total, scope3Total')
    .eq('fiscalYearId', fiscalYearId)
    .maybeSingle();

  if (error) {
    throw new Error('ダッシュボード集計の取得に失敗しました');
  }

  const aggregate = data as DashboardAggregateRow | null;
  if (aggregate) {
    return {
      total:
        toNumber(aggregate.scope1Total) +
        toNumber(aggregate.scope2Total) +
        toNumber(aggregate.scope3Total),
      source: 'aggregate',
    };
  }

  return { total: await getFallbackAnnualActual(supabase, fiscalYearId, period), source: 'monthly' };
};

/** 目標設定モーダルのプレビュー用。選択中の基準年度の実績排出量を単体で取得する。 */
export const getFiscalYearTotalEmissions = async (
  fiscalYearId: string,
  period: { startDate: string; endDate: string },
): Promise<{ total: number; source: EmissionsSource }> =>
  getFiscalYearTotal(createClient(), fiscalYearId, period);

/** 年度ごとの削減率（基準年度比%）。 */
export type ReductionTargetYear = {
  /** 年度の開始年（例: 2031年度なら 2031） */
  targetYear: number;
  reductionPercent: number;
};

/** 保存済みの削減目標（基準年度 + 年度ごとの削減率）。 */
export type ReductionTargetSetting = {
  baseFiscalYear: FiscalYearRef;
  /** 基準年度の実績排出量（削減率の分母） */
  baseYearEmissions: number;
  baseYearSource: EmissionsSource;
  /** 年度ごとの削減率（年度の昇順） */
  targetYears: ReductionTargetYear[];
  /** 年度の開始年 → 年間目標排出量（基準年度実績 × (1 - 削減率/100)） */
  targetsByYear: Record<number, number>;
  /** 表示中の年度の削減率。その年度に削減率が入っていなければ null */
  currentReductionPercent: number | null;
};

export type TargetProgressData = {
  /** 保存済みの削減目標。未設定なら null */
  target: ReductionTargetSetting | null;
  annualProgress: AnnualProgress;
  /**
   * 表示中の年度の年間実績（累計）の出典。
   * - 'aggregate': dashboard_aggregates の確定値（Scope 3 等の年次集計を含む）
   * - 'monthly': 算定結果の合算（Scope 1/2 の月別集計 + Scope 3 の採用値。算定バッチ未確定の年度向けフォールバック）
   */
  actualSource: EmissionsSource;
};

// ダッシュボードの削減目標カードの表示データ（保存済みの目標＋表示年度の達成状況）を組み立てる。
// fiscalYears には FiscalYearContext の年度一覧を渡す（基準年度の期間・ラベルの解決に使い、
// fiscal_years への追加クエリを避ける）。基準年度が一覧に無い場合（他組織・削除済み）は
// 目標未設定として扱う。
export const getTargetProgress = async (
  fiscalYearId: string,
  period: { startDate: string; endDate: string },
  fiscalYears: FiscalYearRef[],
): Promise<TargetProgressData> => {
  const supabase = createClient();

  // 組織スコープは RLS 任せ。organizationId のユニーク制約により基準年度は高々1行。
  const [targetResult, targetYearsResult] = await Promise.all([
    supabase.from('reduction_targets').select('baseFiscalYearId').maybeSingle(),
    supabase
      .from('reduction_target_years')
      .select('targetYear, reductionPercent')
      .order('targetYear', { ascending: true }),
  ]);

  if (targetResult.error || targetYearsResult.error) {
    throw new Error('削減目標の取得に失敗しました');
  }

  const targetRow = targetResult.data as ReductionTargetRow | null;
  const baseFiscalYear = targetRow
    ? fiscalYears.find(year => year.id === targetRow.baseFiscalYearId) ?? null
    : null;
  const targetYears: ReductionTargetYear[] = ((targetYearsResult.data ?? []) as ReductionTargetYearRow[])
    .map(row => ({ targetYear: row.targetYear, reductionPercent: toNumber(row.reductionPercent) }));

  const [actual, baseYear] = await Promise.all([
    getFiscalYearTotal(supabase, fiscalYearId, period),
    // 基準年度が表示中の年度と同じでも、条件分岐を増やさず素直にもう一度引く
    // （どちらも高々2クエリで、年度切替のたびに走るほどの負荷ではない）。
    baseFiscalYear ? getFiscalYearTotal(supabase, baseFiscalYear.id, baseFiscalYear) : null,
  ]);

  let target: ReductionTargetSetting | null = null;
  if (baseFiscalYear && baseYear) {
    const currentYear = getFiscalYearStartYearFromDate(period.startDate);
    target = {
      baseFiscalYear,
      baseYearEmissions: baseYear.total,
      baseYearSource: baseYear.source,
      targetYears,
      targetsByYear: buildTargetsByYear(baseYear.total, targetYears),
      currentReductionPercent:
        targetYears.find(entry => entry.targetYear === currentYear)?.reductionPercent ?? null,
    };
  }

  // 表示中の年度に削減率が入っていなければ「目標未設定」。基準年度そのものを表示している
  // 場合も、削減率0%の行が無い限り目標なしとして扱う（基準年度は比較対象ではないため）。
  const annualTarget =
    target && target.currentReductionPercent !== null
      ? target.targetsByYear[getFiscalYearStartYearFromDate(period.startDate)] ?? null
      : null;

  return {
    target,
    annualProgress: buildAnnualProgress(actual.total, annualTarget),
    actualSource: actual.source,
  };
};

// 削減目標（基準年度 + 年度ごとの削減率）を保存する。
// 年度ごとの削減率はモーダルで一括編集するため、渡された年度の集合をそのまま正とし、
// 含まれない年度の行（＝空欄にした年度）は削除する。
export const saveReductionTarget = async (
  baseFiscalYearId: string,
  targetYears: ReductionTargetYear[],
): Promise<void> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { error: baseError } = await supabase
    .from('reduction_targets')
    .upsert({ organizationId, baseFiscalYearId }, { onConflict: 'organizationId' });
  if (baseError) {
    throw new Error('削減目標の保存に失敗しました');
  }

  // 先に不要な年度を消してから入れ直す。順序を逆にすると、削除条件から漏れた年度が
  // 残ったままになる可能性がある。
  const keepYears = targetYears.map(entry => entry.targetYear);
  let deleteQuery = supabase.from('reduction_target_years').delete().eq('organizationId', organizationId);
  if (keepYears.length > 0) {
    deleteQuery = deleteQuery.not('targetYear', 'in', `(${keepYears.join(',')})`);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    throw new Error('削減目標の保存に失敗しました');
  }

  if (targetYears.length === 0) return;

  const { error: upsertError } = await supabase.from('reduction_target_years').upsert(
    targetYears.map(entry => ({
      organizationId,
      targetYear: entry.targetYear,
      reductionPercent: entry.reductionPercent,
    })),
    { onConflict: 'organizationId,targetYear' },
  );
  if (upsertError) {
    throw new Error('削減目標の保存に失敗しました');
  }
};

// 削減目標を未設定に戻す（基準年度の行を削除する。年度ごとの削減率は cascade で消える）。
export const clearReductionTarget = async (): Promise<void> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { error } = await supabase
    .from('reduction_targets')
    .delete()
    .eq('organizationId', organizationId);
  if (error) {
    throw new Error('削減目標の削除に失敗しました');
  }
};
