// Scope3積上げ入力（IDEA連携）のインライン概算（純関数・副作用なし）。
// 保存後の算定（docs/idea-scope3-spec.md §4.3）と同じ値を出すことが受け入れ条件のため、
// 正規化は normalizeIdeaFactor を、単位換算・丸めは算定エンジンと共通の
// computeEstimatedEmissions（resolveUnitConversion + roundEmissions）をそのまま使い、
// 独自の計算式を持たない。等価性は scope3InlineCalculation.test.ts で
// computeScope3Emissions（算定バッチの実体）と直接比較して担保する。

import { normalizeIdeaFactor } from '@/features/calculation/services/scope3Calculation';
import type { IdeaFactorRow } from '@/features/calculation/types';
import { computeEstimatedEmissions } from './inlineCalculation';

/**
 * Scope3積上げレコードの推定排出量（t-CO2e）を計算する。
 * 活動量の単位は製品から自動設定される（= factor.unit と常に一致する）ため、
 * 通常 null にはならないが、算定バッチと同じ検証を通すため null（換算不能）も返しうる。
 *
 * @param amount 活動量（選択製品の単位）
 * @param factor 選択した IDEA 係数行（gwpValue / baseFlowAmount は string でも可）
 * @param applicableYear 係数適用年度（IDEA は年度非依存。正規化行の applicableYear に入るだけで値には影響しない）
 */
export const computeEstimatedScope3Emissions = (
  amount: number,
  factor: IdeaFactorRow,
  applicableYear: number,
): number | null => {
  const normalized = normalizeIdeaFactor(factor, applicableYear);
  return computeEstimatedEmissions(amount, factor.unit, normalized);
};

/**
 * 概算表示用の原単位（kg-CO2e/単位）。正規化と同じ式（gwpValue / baseFlowAmount）で求める。
 * 表示のみに使い、計算は computeEstimatedScope3Emissions を通すこと。
 */
export const toIdeaFactorValue = (factor: Pick<IdeaFactorRow, 'gwpValue' | 'baseFlowAmount'>): number =>
  Number(factor.gwpValue) / Number(factor.baseFlowAmount);
