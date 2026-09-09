// 統合データ入力フォームの入力検証と保存内容の組み立て（純関数・副作用なし）。
// 手動入力と Scope3 入力の検証を 1 箇所に集約し、検証順序と文言を固定する。

import type { ActivityEntryInput } from '../types';
import type { EntryCategory, EntryMode, EntryPath } from './entryCategory';
import type { ManualEntryPeriodDates } from './manualEntryTargetMonth';

/** 半角数字と小数点 1 個のみ。入力時フィルタに使う（空文字・'.'・'1.' もパターン上は通る）。 */
export const DECIMAL_PATTERN = /^\d*(?:\.\d*)?$/;
export const NOTE_MAX_LENGTH = 500;

/**
 * 活動量の桁数上限。activity_records.amount は numeric(15,3)（整数部 12 桁・小数部 3 桁）なので、
 * 小数第 4 位以下だけの微小値は DB で 0.000 に丸まり（プレビューでは非ゼロなのに算定結果が 0 になる）、
 * 整数部 13 桁以上は numeric overflow で原因の分からない汎用エラーになる。保存前に弾いて防ぐ。
 */
export const AMOUNT_MAX_INTEGER_DIGITS = 12;
export const AMOUNT_MAX_FRACTION_DIGITS = 3;

export type AmountValidation =
  | { kind: 'valid'; value: number }
  /** 空・数値でない・0 以下 */
  | { kind: 'invalid' }
  /** 整数部が AMOUNT_MAX_INTEGER_DIGITS を超える */
  | { kind: 'too-large' }
  /** 小数部が AMOUNT_MAX_FRACTION_DIGITS を超える */
  | { kind: 'too-precise' };

/** 活動量の検証。DECIMAL_PATTERN・有限・> 0 に加え、numeric(15,3) に収まる桁数かを見る。 */
export const validateAmount = (amount: string): AmountValidation => {
  if (amount === '' || !DECIMAL_PATTERN.test(amount)) {
    return { kind: 'invalid' };
  }
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { kind: 'invalid' };
  }
  // 桁数は入力文字列で数える（Number は 16 桁以上で丸まり、桁あふれを検出できない）。
  // 値に影響しない整数部の先頭 0・小数部の末尾 0（'0001.2300'）は桁に数えない。
  const [integerPart = '', fractionPart = ''] = amount.split('.');
  if (integerPart.replace(/^0+/, '').length > AMOUNT_MAX_INTEGER_DIGITS) {
    return { kind: 'too-large' };
  }
  if (fractionPart.replace(/0+$/, '').length > AMOUNT_MAX_FRACTION_DIGITS) {
    return { kind: 'too-precise' };
  }
  return { kind: 'valid', value: parsed };
};

/** 活動量として妥当（validateAmount が valid）なら数値、そうでなければ null。 */
export const parseValidAmount = (amount: string): number | null => {
  const result = validateAmount(amount);
  return result.kind === 'valid' ? result.value : null;
};

export type EntryFactorValidationState =
  | { source: 'provider' | 'standard' }
  | {
      source: 'idea';
      productSelected: boolean;
      /** 製品詳細を取得済み（概算・保存に必要） */
      productReady: boolean;
      /** 参照切れ（孤児 / 参照先削除） */
      isFactorMissing: boolean;
      /** 製品詳細の取得失敗文言（通信失敗） */
      detailError: string | null;
    };

export interface EntryValidationInput {
  /** effectiveSelectedLocationId */
  locationId: string;
  targetMonthError: string | null;
  amount: string;
  note: string;
  factor: EntryFactorValidationState;
}

export const VALIDATION_MESSAGES = {
  location: '拠点を選択してください。',
  product: 'IDEA製品を検索して選択してください。',
  amount: '活動量は0より大きい半角数字で入力してください。',
  amountTooLarge: `活動量は整数部${AMOUNT_MAX_INTEGER_DIGITS}桁以内（${(10 ** AMOUNT_MAX_INTEGER_DIGITS - 1).toLocaleString('ja-JP')} 以下）で入力してください。`,
  amountTooPrecise: `活動量は小数第${AMOUNT_MAX_FRACTION_DIGITS}位までで入力してください。`,
  note: '備考は500文字以内で入力してください。',
  /** handleSave の再ガード（validate 通過後に period / 製品詳細が無い） */
  inconsistent: '入力内容を確認してください。',
} as const;

/** validateAmount の結果に対応する文言。valid なら null。 */
export const amountValidationMessage = (result: AmountValidation): string | null => {
  switch (result.kind) {
    case 'valid':
      return null;
    case 'too-large':
      return VALIDATION_MESSAGES.amountTooLarge;
    case 'too-precise':
      return VALIDATION_MESSAGES.amountTooPrecise;
    case 'invalid':
      return VALIDATION_MESSAGES.amount;
  }
};

/**
 * 検証順序（最初のエラーを返す）: 拠点 → 対象年月 → （IDEA: 製品）→ 活動量（> 0・桁数）→ 備考 500 文字。
 * 製品未選択の文言は参照切れなら factorMissing（SCOPE3_FACTOR_MISSING_MESSAGE）を優先する。
 */
export const validateEntry = (
  input: EntryValidationInput,
  messages: { factorMissing: string },
): string | null => {
  if (!input.locationId) {
    return VALIDATION_MESSAGES.location;
  }
  if (input.targetMonthError) {
    return input.targetMonthError;
  }
  if (input.factor.source === 'idea') {
    if (input.factor.detailError) {
      return input.factor.detailError;
    }
    if (!input.factor.productSelected || !input.factor.productReady) {
      return input.factor.isFactorMissing ? messages.factorMissing : VALIDATION_MESSAGES.product;
    }
  }
  const amountError = amountValidationMessage(validateAmount(input.amount));
  if (amountError) {
    return amountError;
  }
  if (input.note.length > NOTE_MAX_LENGTH) {
    return VALIDATION_MESSAGES.note;
  }
  return null;
};

/**
 * onSave に渡す保存内容を組み立てる。備考は trim 後の空を null。
 *   energy: unit はカテゴリの標準単位または編集で保持した記録の単位、emissionFactorId は resolveFactorIdToSave の結果
 *   scope3: unit は選択製品の unit（自動設定・編集不可。算定時の単位換算は常に 1:1）、ideaFactorId は選択製品の id
 * scope3 で ideaFactorId が無ければ組み立てられない（null）。
 */
export const buildActivityEntryInput = (args: {
  category: EntryCategory;
  locationId: string;
  period: ManualEntryPeriodDates;
  amount: number;
  unit: string;
  note: string;
  emissionFactorId: string | null;
  ideaFactorId: string | null;
}): ActivityEntryInput | null => {
  const common = {
    locationId: args.locationId,
    amount: args.amount,
    unit: args.unit,
    periodStart: args.period.start,
    periodEnd: args.period.end,
    note: args.note.trim() || null,
  };
  if (args.category.kind === 'scope3') {
    if (args.ideaFactorId === null) {
      return null;
    }
    return {
      kind: 'scope3',
      input: { ...common, scope3CategoryId: args.category.categoryId, ideaFactorId: args.ideaFactorId },
    };
  }
  return {
    kind: 'scope12',
    input: { ...common, energyType: args.category.energyType, emissionFactorId: args.emissionFactorId },
  };
};

/** onSave が Error 以外で reject したときのフォールバック文言（サービスの文言と揃える）。 */
export const SAVE_FAILURE_MESSAGES: Record<EntryPath, Record<EntryMode, string>> = {
  scope12: { create: '活動量レコードの登録に失敗しました', edit: '活動量レコードの更新に失敗しました' },
  scope3: { create: 'Scope3活動量レコードの登録に失敗しました', edit: 'Scope3活動量レコードの更新に失敗しました' },
};
