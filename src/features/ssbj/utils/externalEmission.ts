// 外部で算定した排出量（外部算定値。docs/ssbj-spec.md §13）の純関数: 表示名、入力の正規化・検証、保存版の検査。
// 必須項目・Scope とカテゴリ・基準の組み合わせ・二重計上の正本は DB（制約と遅延の制約トリガー）で、ここは画面の案内のための写し。

import { SCOPE3_CATEGORY_NAMES } from '@/features/scope-analysis/services/scopeAnalysisService';
import {
  OGT_EMISSION_UNIT,
  SSBJ_GHG_GASES,
  SSBJ_SCOPE2_BASES,
  SSBJ_SCOPE2_BASIS_LABELS,
  type SsbjExternalEmission,
  type SsbjExternalEmissionSnapshot,
  type SsbjGhgGas,
  type SsbjScope2Basis,
} from '../types';
import { isDecimalString } from './decimal';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 区分名（例「Scope 1」「Scope 2（ロケーション基準）」「Scope 3 カテゴリ 4：輸送、配送（上流）」）。 */
export const externalEmissionLabel = (
  emission: Pick<SsbjExternalEmission, 'scope' | 'scope3CategoryId' | 'scope2Basis'>,
): string => {
  if (emission.scope === 2) {
    return `Scope 2（${emission.scope2Basis ? SSBJ_SCOPE2_BASIS_LABELS[emission.scope2Basis] : '基準なし'}）`;
  }
  if (emission.scope === 3) {
    const id = emission.scope3CategoryId;
    return id === null ? 'Scope 3' : `Scope 3 カテゴリ ${id}：${SCOPE3_CATEGORY_NAMES[id] ?? ''}`;
  }
  return 'Scope 1';
};

/** 対象ガスの表示（例「CH4・N2O」）。並びは 7 種類の順にそろえる。 */
export const externalEmissionGasesLabel = (gases: readonly SsbjGhgGas[]): string =>
  SSBJ_GHG_GASES.filter(gas => gases.includes(gas)).join('・');

export type SsbjExternalEmissionInput = Omit<SsbjExternalEmission, 'id' | 'unit'>;

/** 画面の入力欄の値（すべて文字列。保存の前に正規化・検証する）。 */
export type SsbjExternalEmissionFormValues = {
  scope: '' | '1' | '2' | '3';
  scope3CategoryId: string;
  scope2Basis: '' | SsbjScope2Basis;
  gases: SsbjGhgGas[];
  value: string;
  periodStart: string;
  periodEnd: string;
  calculatedBy: string;
  calculationMethod: string;
  evidenceId: string;
  confirmedByUserId: string;
  /** 確認した日（YYYY-MM-DD）。保存するときはその日の 0 時（日本時間）にする。 */
  confirmedOn: string;
  internalNote: string;
};

/** 新規作成の初期値。期間はレポートの算定年度の期間、確認した日は今日。 */
export const emptyExternalEmissionForm = (
  period: { startDate: string; endDate: string },
  today: string,
): SsbjExternalEmissionFormValues => ({
  scope: '',
  scope3CategoryId: '',
  scope2Basis: '',
  gases: [],
  value: '',
  periodStart: period.startDate,
  periodEnd: period.endDate,
  calculatedBy: '',
  calculationMethod: '',
  evidenceId: '',
  confirmedByUserId: '',
  confirmedOn: today,
  internalNote: '',
});

/** 確認した日 → 確認日時（日本時間の 0 時）。 */
export const confirmedOnToTimestamp = (date: string): string => `${date}T00:00:00+09:00`;

/** 確認日時 → 確認した日（日本時間）。 */
export const timestampToConfirmedOn = (timestamp: string): string =>
  new Date(new Date(timestamp).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const toExternalEmissionFormValues = (emission: SsbjExternalEmission): SsbjExternalEmissionFormValues => ({
  scope: String(emission.scope) as '1' | '2' | '3',
  scope3CategoryId: emission.scope3CategoryId === null ? '' : String(emission.scope3CategoryId),
  scope2Basis: emission.scope2Basis ?? '',
  gases: [...emission.gases],
  value: emission.value,
  periodStart: emission.period.startDate,
  periodEnd: emission.period.endDate,
  calculatedBy: emission.calculatedBy,
  calculationMethod: emission.calculationMethod,
  evidenceId: emission.evidenceId,
  confirmedByUserId: emission.confirmedByUserId,
  confirmedOn: timestampToConfirmedOn(emission.confirmedAt),
  internalNote: emission.internalNote ?? '',
});

/** 入力欄の値を保存する形にする（前後の空白を除き、Scope に関係しない欄は空にする）。 */
export const normalizeExternalEmissionInput = (values: SsbjExternalEmissionFormValues): SsbjExternalEmissionInput => {
  const scope = Number(values.scope) as 1 | 2 | 3;
  return {
    scope,
    scope3CategoryId: scope === 3 && values.scope3CategoryId !== '' ? Number(values.scope3CategoryId) : null,
    scope2Basis: scope === 2 && values.scope2Basis !== '' ? values.scope2Basis : null,
    gases: SSBJ_GHG_GASES.filter(gas => values.gases.includes(gas)),
    value: values.value.trim(),
    period: { startDate: values.periodStart, endDate: values.periodEnd },
    calculatedBy: values.calculatedBy.trim(),
    calculationMethod: values.calculationMethod.trim(),
    evidenceId: values.evidenceId,
    confirmedByUserId: values.confirmedByUserId,
    confirmedAt: values.confirmedOn === '' ? '' : confirmedOnToTimestamp(values.confirmedOn),
    internalNote: values.internalNote.trim() || null,
  };
};

/** 足りない・正しくない項目の案内（空なら保存できる）。 */
export const validateExternalEmissionInput = (input: SsbjExternalEmissionInput): string[] => {
  const errors: string[] = [];
  if (![1, 2, 3].includes(input.scope)) errors.push('Scope を選んでください');
  if (input.scope === 3 && (input.scope3CategoryId === null || input.scope3CategoryId < 1 || input.scope3CategoryId > 15)) {
    errors.push('Scope 3 のカテゴリを選んでください');
  }
  if (input.scope === 2 && input.scope2Basis === null) errors.push('Scope 2 の基準（ロケーション基準・マーケット基準）を選んでください');
  if (input.gases.length === 0) errors.push('対象ガスを 1 つ以上選んでください');
  if (!isDecimalString(input.value) || input.value.startsWith('-')) {
    errors.push('排出量は 0 以上の数値で入力してください（例 1234.5。カンマ・指数表記は使えません）');
  }
  if (!DATE_PATTERN.test(input.period.startDate) || !DATE_PATTERN.test(input.period.endDate)) {
    errors.push('期間を入力してください');
  } else if (input.period.endDate < input.period.startDate) {
    errors.push('期間の終わりは、始まりと同じ日かそれより後にしてください');
  }
  if (!input.calculatedBy) errors.push('算定した者（会社・部署・システム）を入力してください');
  if (!input.calculationMethod) errors.push('算定方法を入力してください');
  if (!input.evidenceId) errors.push('根拠文書を選んでください');
  if (!input.confirmedByUserId) errors.push('確認者を選んでください');
  if (!input.confirmedAt) errors.push('確認した日を入力してください');
  return errors;
};

/**
 * 保存版の外部算定値の、開示する項目（区分・対象ガス・排出量・期間）の形を確かめる。
 * 閲覧者に返す保存版は内部記録を除いてある（utils/disclosedSnapshot.ts）ので、出典の詳細は確かめない。
 */
export const isValidExternalEmissionDisclosure = (item: unknown): boolean => {
  if (typeof item !== 'object' || item === null) return false;
  const value = item as Partial<SsbjExternalEmissionSnapshot>;
  return (
    typeof value.id === 'string' &&
    (value.scope === 1 || value.scope === 2 || value.scope === 3) &&
    (value.scope === 3 ? typeof value.scope3CategoryId === 'number' : value.scope3CategoryId === null) &&
    (value.scope === 2
      ? (SSBJ_SCOPE2_BASES as readonly unknown[]).includes(value.scope2Basis)
      : value.scope2Basis === null) &&
    Array.isArray(value.gases) && value.gases.length > 0 &&
    value.gases.every(gas => (SSBJ_GHG_GASES as readonly string[]).includes(gas)) &&
    isDecimalString(value.value) &&
    value.unit === OGT_EMISSION_UNIT &&
    typeof value.period?.startDate === 'string' && typeof value.period?.endDate === 'string'
  );
};

/** 保存版の外部算定値の形を確かめる（不正なら出力・表示しない）。 */
export const isValidExternalEmissionSnapshot = (item: unknown): item is SsbjExternalEmissionSnapshot => {
  if (!isValidExternalEmissionDisclosure(item)) return false;
  const value = item as Partial<SsbjExternalEmissionSnapshot>;
  return (
    typeof value.calculatedBy === 'string' && typeof value.calculationMethod === 'string' &&
    typeof value.evidenceId === 'string' && typeof value.confirmedByUserId === 'string' &&
    typeof value.confirmedAt === 'string'
  );
};
