// OGT の削減目標の採用（R2-32。docs/ssbj-spec.md §13「OGT の値の採用（T08b）」の「R2 の追加（削減目標の採用。R2-32）」）の純関数:
// DB 関数 ssbj_ogt_reduction_target の結果の検証・変換、レポートの年度の実績と目標の差、採用後の変化の判定。

import {
  OGT_EMISSION_UNIT,
  type OgtCandidateValue,
  type SsbjDecimalString,
  type SsbjFieldValue,
  type SsbjReductionTargetAdoption,
  type SsbjReductionTargetYear,
} from '../types';
import { formatDecimalForDisplay, isDecimalString, subtractDecimalStrings } from './decimal';

/** 採用後の変化の一覧（changedOgtValueLabels）に出す名前。 */
export const REDUCTION_TARGET_CHANGED_LABEL = '削減目標';

const UNANSWERED: SsbjFieldValue<SsbjDecimalString> = { state: 'unanswered' };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isDateString = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** DB の十進文字列（null は未算定・未設定）→ 値の状態。数値の形でなければ例外にする（0 にしない）。 */
const decimalOrUnanswered = (value: unknown): SsbjFieldValue<SsbjDecimalString> => {
  if (value === null || value === undefined) return UNANSWERED;
  if (!isDecimalString(value)) throw new Error('削減目標の値の形式が正しくありません');
  return { state: 'answered', value };
};

const isPositive = (value: SsbjFieldValue<SsbjDecimalString>): boolean =>
  value.state === 'answered' && !value.value.startsWith('-') && !/^0*(\.0*)?$/.test(value.value);

/**
 * レポートの年度の Scope 別の候補値（Scope 1・Scope 2・Scope 3 の合計）のどれかが算定済みか。すべて未算定なら、
 * 集計行（0 の行が残ることがある）があっても、削減目標の実績は未算定にする。
 */
export const hasCalculatedScopeTotals = (candidates: OgtCandidateValue[]): boolean =>
  candidates.some(candidate => candidate.scope3CategoryId === null && candidate.value.state === 'answered');

/**
 * ssbj_ogt_reduction_target の結果を採用値の形にする。年度が見えない（null）ときは例外にする
 * （レポートの年度は必ず見えるため、見えないのは権限か年度の不整合）。
 * reportYearCalculated は hasCalculatedScopeTotals の結果（false なら実績を未算定にする）。
 * 基準年度に正の実績が無いときは、削減率は残し、目標排出量を未算定にする（0 を基準にした目標で超過に見せない）。
 */
export const toSsbjReductionTarget = (
  raw: unknown,
  { reportYearCalculated }: { reportYearCalculated: boolean },
): SsbjReductionTargetAdoption => {
  if (!isObject(raw)) throw new Error('削減目標を取得できませんでした');
  if (raw.status === 'not_set') return { status: 'not_set' };
  if (raw.status !== 'set') throw new Error('削減目標の形式が正しくありません');

  const base = raw.baseFiscalYear;
  if (
    !isObject(base) || typeof base.id !== 'string' || typeof base.label !== 'string' ||
    !isDateString(base.startDate) || !isDateString(base.endDate) ||
    typeof raw.baseYearEnded !== 'boolean' || typeof raw.reportFiscalYearId !== 'string' ||
    !Number.isInteger(raw.reportYear) || !Array.isArray(raw.targetYears)
  ) {
    throw new Error('削減目標の形式が正しくありません');
  }

  const baseYearEmissions = decimalOrUnanswered(raw.baseYearEmissions);
  const baseUsable = isPositive(baseYearEmissions);
  const targetYears: SsbjReductionTargetYear[] = raw.targetYears.map(item => {
    if (!isObject(item) || !Number.isInteger(item.targetYear) || !isDecimalString(item.reductionPercent)) {
      throw new Error('削減目標の年度の形式が正しくありません');
    }
    return {
      targetYear: item.targetYear as number,
      reductionPercent: item.reductionPercent,
      targetEmissions: baseUsable ? decimalOrUnanswered(item.targetEmissions) : UNANSWERED,
    };
  });
  const reportYear = raw.reportYear as number;
  const current = targetYears.find(item => item.targetYear === reportYear);

  return {
    status: 'set',
    baseFiscalYear: { id: base.id, label: base.label, startDate: base.startDate, endDate: base.endDate },
    baseYearEnded: raw.baseYearEnded,
    baseYearEmissions,
    targetYears,
    reportYear: {
      fiscalYearId: raw.reportFiscalYearId,
      targetYear: reportYear,
      // 削減率を入れていない年度は「目標未設定」。0% にしない。
      reductionPercent: current ? { state: 'answered', value: current.reductionPercent } : UNANSWERED,
      targetEmissions: current ? current.targetEmissions : UNANSWERED,
      actualEmissions: reportYearCalculated ? decimalOrUnanswered(raw.reportYearEmissions) : UNANSWERED,
    },
    unit: OGT_EMISSION_UNIT,
  };
};

/**
 * レポートの年度の実績と目標の差（実績 − 目標。負なら目標を下回っている）。目標未設定・未算定なら unanswered。
 */
export const reductionTargetGap = (target: SsbjReductionTargetAdoption): SsbjFieldValue<SsbjDecimalString> => {
  if (target.status !== 'set') return UNANSWERED;
  const { targetEmissions, actualEmissions } = target.reportYear;
  if (targetEmissions.state !== 'answered' || actualEmissions.state !== 'answered') return UNANSWERED;
  return { state: 'answered', value: subtractDecimalStrings(actualEmissions.value, targetEmissions.value) };
};

/** 排出量の表示（未算定は「未算定」。0 にしない）。 */
export const formatTargetEmissions = (value: SsbjFieldValue<SsbjDecimalString>): string =>
  value.state === 'answered' ? `${formatDecimalForDisplay(value.value)} ${OGT_EMISSION_UNIT}` : '未算定';

/** 差の表示（「目標を 12.5 t-CO2e 上回る」など）。 */
export const formatTargetGap = (gap: SsbjFieldValue<SsbjDecimalString>): string => {
  if (gap.state !== 'answered') return '—';
  if (gap.value.startsWith('-')) return `目標を ${formatDecimalForDisplay(gap.value.slice(1))} ${OGT_EMISSION_UNIT} 下回る`;
  if (/^0(\.0+)?$/.test(gap.value)) return '目標と同じ';
  return `目標を ${formatDecimalForDisplay(gap.value)} ${OGT_EMISSION_UNIT} 上回る`;
};

/** レポートの年度の削減率の表示（未設定は「目標未設定」）。 */
export const formatReportYearReduction = (target: SsbjReductionTargetAdoption): string => {
  if (target.status !== 'set') return '目標未設定';
  const { reductionPercent } = target.reportYear;
  return reductionPercent.state === 'answered' ? `基準年度比 ${reductionPercent.value}% 削減` : '目標未設定';
};

/** 基準年度に正の実績が無く、目標排出量を算定できないか（削減率は設定済み）。 */
export const isBaseYearUnusable = (target: Extract<SsbjReductionTargetAdoption, { status: 'set' }>): boolean =>
  !isPositive(target.baseYearEmissions);

/** 基準年度に正の実績が無いときの注意。 */
export const BASE_YEAR_NO_EMISSIONS_NOTE =
  '基準年度の排出量が算定されていない（または 0）ため、目標排出量と実績との差は算定できません（削減率は OGT の設定のとおりです）';

/** 基準年度が期中だったときの注意（docs/functional-spec.md §4.7 を採用値に引き継ぐ）。 */
export const BASE_YEAR_IN_PROGRESS_NOTE =
  '採用した時点で基準年度が終わっていなかったため、基準年度の排出量は期中の累計です（目標排出量は採用した時点の値で固定しています）';

// 採用後の変化の判定に使う項目。基準年度が終わったか（baseYearEnded）は日付で変わるだけなので比べない。
const comparable = (target: SsbjReductionTargetAdoption): unknown =>
  target.status === 'set' ? { ...target, baseYearEnded: undefined } : target;

/**
 * 採用した削減目標と OGT の現在の削減目標が違うか。adopted が undefined（削減目標を一緒に採用する前の採用）のときは、
 * OGT に目標があれば違うとする（採用し直せば目標も入ることを知らせるため）。
 */
export const isReductionTargetChanged = (
  adopted: SsbjReductionTargetAdoption | undefined,
  current: SsbjReductionTargetAdoption,
): boolean => {
  if (adopted === undefined) return current.status === 'set';
  return JSON.stringify(sortKeys(comparable(adopted))) !== JSON.stringify(sortKeys(comparable(current)));
};

// jsonb はキーの順を保たないため、比べる前にキーを並べ替える。
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => [key, sortKeys(value[key])]));
  }
  return value;
};
