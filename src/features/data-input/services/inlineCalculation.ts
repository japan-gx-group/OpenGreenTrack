// データ入力画面のインライン計算（純関数・副作用なし）。
// 入力フォームで「適用される係数」と「推定排出量」を保存前に表示するためのロジックを、
// UIから分離してここに集約する。
// 係数の優先順位・単位換算は算定エンジン（features/calculation/engine）と同じ実装を
// 使い回し、プレビューと実際の算定バッチの結果がずれないようにする。

import type { EmissionFactorRow } from '@/features/calculation/types';
import {
  deriveApplicableYear,
  listFactorCandidates,
} from '@/features/calculation/engine/resolveEmissionFactor';
import { resolveUnitConversion } from '@/features/calculation/engine/units';
import { roundEmissions } from '@/features/calculation/engine/computeEmissions';

export { listFactorCandidates };

/** 会計年度の期間（fiscal_years マスタ由来。FiscalYearOption のサブセット）。 */
export interface FiscalYearRange {
  id: string;
  startDate: string;
  endDate: string;
}

/**
 * 指定日（YYYY-MM-DD）を含む会計年度を返す。無ければ null。
 * 渡した要素型をそのまま返すため、FiscalYearOption を渡せば label など期間以外の項目も使える。
 */
export const findFiscalYearForDate = <T extends FiscalYearRange>(
  fiscalYears: T[],
  date: string,
): T | null => fiscalYears.find((fy) => fy.startDate <= date && date <= fy.endDate) ?? null;

/**
 * 指定日の係数解決コンテキスト（FactorResolutionContext.applicableYear）に渡す会計年度の開始年を返す。
 * 算定バッチ（calculationService）は fiscal_years.startDate の年をコンテキストにするため、
 * 該当する会計年度があればその開始年を使う（非4月始まり年度でもバッチと一致させる）。
 * 該当年度が無い場合のみ periodStart からの導出（4月始まり仮定）へフォールバックする。
 * 係数の取得対象年度はこの値そのものではなく applicableYearsForRecord（開始年＋対象月の温対法年度）で
 * 決める（useScope12FactorSelection）。非4月始まりの組織では年度境界の月で公式係数の年度がずれるため。
 */
export const applicableYearForDate = (
  fiscalYears: FiscalYearRange[],
  date: string,
): number => {
  const fiscalYear = findFiscalYearForDate(fiscalYears, date);
  if (fiscalYear) {
    const year = Number(fiscalYear.startDate.slice(0, 4));
    if (Number.isInteger(year)) {
      return year;
    }
  }
  return deriveApplicableYear(date);
};

/**
 * 保存した活動量の periodStart 群から、自動計算を実行すべき会計年度IDを集める。
 * 戻り値の uncoveredCount は「どの会計年度にも属さず、自動計算の対象外になる件数」。
 */
export const collectFiscalYearIdsForPeriodStarts = (
  fiscalYears: FiscalYearRange[],
  periodStarts: string[],
): { fiscalYearIds: string[]; uncoveredCount: number } => {
  const ids = new Set<string>();
  let uncoveredCount = 0;
  for (const periodStart of periodStarts) {
    const fiscalYear = findFiscalYearForDate(fiscalYears, periodStart);
    if (fiscalYear) {
      ids.add(fiscalYear.id);
    } else {
      uncoveredCount += 1;
    }
  }
  return { fiscalYearIds: [...ids], uncoveredCount };
};

/**
 * 推定排出量（t-CO2e）を計算する。
 * 算定エンジンと同じ丸め（小数第6位）・単位換算を使う。
 * 単位を換算できない場合は null。表示側は従来どおり小数第3位で整形する。
 */
export const computeEstimatedEmissions = (
  amount: number,
  activityUnit: string,
  factor: EmissionFactorRow,
): number | null => {
  const conversion = resolveUnitConversion(activityUnit, factor.unit);
  if (conversion === null) {
    return null;
  }
  return roundEmissions(amount * conversion * factor.factorValue);
};
