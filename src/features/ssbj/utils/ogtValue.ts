// OGT の算定値（OgtCandidateValue / OgtAdoptedValue）の充足状態の判定と整合性チェック。
// 候補値を出す側（T08a）と採用・固定する側（T08b）で判定がずれないよう、規則をここに一本化する
// （規則の説明は docs/ssbj-spec.md §7）。

import { SCOPE3_CATEGORY_NAMES } from '@/features/scope-analysis/services/scopeAnalysisService';
import {
  OGT_EMISSION_UNIT,
  type OgtCalculationCoverage,
  type OgtCandidateValue,
  type OgtDataQuality,
  type OgtValueSource,
} from '../types';
import { isDecimalString } from './decimal';

export const OGT_DATA_QUALITY_LABELS: Record<OgtDataQuality, string> = {
  all_calculated: '算定済み',
  partially_calculated: '一部未算定',
  not_calculated: '未算定',
};

// 以下の表示名は、候補値の画面・プレビュー・CSV で同じ表記にするためにここへまとめている。

export const OGT_SOURCE_LABELS: Record<OgtValueSource['aggregate'], string> = {
  dashboard_aggregates: '年度集計',
  dashboard_scope3_category_emissions: 'カテゴリ別採用値',
  scope3_category_emissions: 'カテゴリ別直接入力',
};

type OgtValueTarget = Pick<OgtCandidateValue, 'scope' | 'scope3CategoryId'>;

/** 区分名（例「Scope 1」「カテゴリ 1：購入した製品・サービス」）。 */
export const ogtValueLabel = (value: OgtValueTarget): string =>
  value.scope3CategoryId === null
    ? `Scope ${value.scope}`
    : `カテゴリ ${value.scope3CategoryId}：${SCOPE3_CATEGORY_NAMES[value.scope3CategoryId] ?? ''}`;

/** 区分の識別子（CSV の対象 ID。例 scope1 / scope3 / scope3.category1）。 */
export const ogtValueKey = (value: OgtValueTarget): string =>
  value.scope3CategoryId === null ? `scope${value.scope}` : `scope3.category${value.scope3CategoryId}`;

/** 採用方式の表示名。 */
export const ogtMethodLabel = (value: OgtCandidateValue): string => {
  if (value.scope === 3 && value.scope3CategoryId !== null) {
    return value.method.kind === 'direct' ? '直接入力' : '積上げ';
  }
  return value.scope === 3 ? 'カテゴリごとの採用方式' : '活動量 × 排出係数';
};

/**
 * 活動量ベースの値（Scope 1・2、Scope 3 積上げ）の充足状態。
 * - 集計行が無い、または算定済みレコードが 0 件 → not_calculated（値は unanswered にし、0 を入れない）
 * - 未算定レコードが 1 件以上 → partially_calculated（値は出すが一部未算定と明示する）
 * - それ以外 → all_calculated（登録済みレコードはすべて算定済み。未入力のデータまでは検知できない）
 */
export const deriveOgtDataQuality = (input: {
  hasAggregate: boolean;
  coverage: OgtCalculationCoverage;
}): OgtDataQuality => {
  if (!input.hasAggregate || input.coverage.calculatedCount === 0) {
    return 'not_calculated';
  }
  return input.coverage.uncalculatedCount > 0 ? 'partially_calculated' : 'all_calculated';
};

/**
 * 直接入力（Scope 3 direct）のカテゴリの充足状態。直接入力の行があれば値あり、無ければ未入力。
 * dashboard_scope3_category_emissions は採用値が 0 のカテゴリを返さないため、
 * 「RPC に行が無い」を 0 とも未入力とも決めつけず、scope3_category_emissions の行の有無で判定する。
 */
export const deriveDirectInputDataQuality = (hasDirectInputRow: boolean): OgtDataQuality =>
  hasDirectInputRow ? 'all_calculated' : 'not_calculated';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0;

/**
 * 候補値・採用値が契約を満たしているかを検査し、違反内容を返す（空配列なら問題なし）。
 * 型だけでは表せない不変条件（未算定なのに値がある、数値が十進文字列でない等）を確認する。
 */
export const checkOgtCandidateValue = (candidate: OgtCandidateValue): string[] => {
  const errors: string[] = [];

  if (candidate.unit !== OGT_EMISSION_UNIT) {
    errors.push(`単位は ${OGT_EMISSION_UNIT} 固定です`);
  }
  if (candidate.dataQuality === 'not_calculated' && candidate.value.state !== 'unanswered') {
    errors.push('未算定の値は未入力（unanswered）にしてください（0 を入れない）');
  }
  if (candidate.value.state === 'answered' && !isDecimalString(candidate.value.value)) {
    errors.push(`排出量が十進表記の文字列ではありません: ${candidate.value.value}`);
  }
  if (
    !ISO_DATE_PATTERN.test(candidate.period.startDate) ||
    !ISO_DATE_PATTERN.test(candidate.period.endDate) ||
    candidate.period.startDate > candidate.period.endDate
  ) {
    errors.push('対象期間が正しくありません');
  }
  if (
    candidate.coverage &&
    (!isCount(candidate.coverage.calculatedCount) || !isCount(candidate.coverage.uncalculatedCount))
  ) {
    errors.push('算定件数は 0 以上の整数にしてください');
  }
  if (candidate.scope === 3 && candidate.scope3CategoryId !== null) {
    if (!Number.isInteger(candidate.scope3CategoryId) || candidate.scope3CategoryId < 1 || candidate.scope3CategoryId > 15) {
      errors.push(`Scope 3 カテゴリは 1〜15 です: ${candidate.scope3CategoryId}`);
    }
  }
  if (candidate.scope === 2 && candidate.method.factorTypeBreakdown) {
    const { basic, adjusted, unclassified } = candidate.method.factorTypeBreakdown;
    if (![basic, adjusted, unclassified].every(isDecimalString)) {
      errors.push('係数種別の内訳が十進表記の文字列ではありません');
    }
  }

  return errors;
};
