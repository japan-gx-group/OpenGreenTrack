// 手動入力フォームの「対象年月（YYYY-MM）」の検証と、月初/月末（YYYY-MM-DD）への変換。
//
// 月初/月末を Date 経由で組み立てないのは、new Date(99, 0, 1) が 1999 年になる 2桁年の
// 仕様を踏むため（0099-02 のような入力が別の年として保存されてしまう）。
// 文字列のまま組み立て、末日だけ自前のうるう年判定で求める。
const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// 対象年月の下限。会計年度マスタが受け付ける年（2000〜2100）に合わせる。
// 参照: src/features/settings/services/fiscalYears.ts
export const MIN_TARGET_MONTH = '2000-01';
const MIN_TARGET_MONTH_LABEL = '2000年1月';

export interface ManualEntryPeriodDates {
  start: string;
  end: string;
}

// エラー時は period を返さない判別可能ユニオン。エラー付きの期間を保存処理へ
// 誤って渡せないようにするため（error を見落としても period が null で止まる）。
export type TargetMonthValidationResult =
  | { period: ManualEntryPeriodDates; error: null }
  | { period: null; error: string };

export interface ValidateTargetMonthOptions {
  // 編集対象レコードが保存時点で持っている対象年月。未来月のレコードでも備考や活動量だけを
  // 直して保存できるよう、年月を変えないなら例外的に許可する。
  allowedFutureMonth?: string | null;
}

export const getCurrentYearMonth = (date: Date = new Date()): string =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const isValidYearMonth = (yearMonth: string): boolean => YEAR_MONTH_PATTERN.test(yearMonth);

const lastDayOfMonth = (year: number, month: number): number => {
  if (month === 2) {
    const isLeapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
    return isLeapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

// YYYY-MM を月初・月末の日付へ変換する。形式が不正なら null。
export const toPeriodDates = (yearMonth: string): ManualEntryPeriodDates | null => {
  if (!isValidYearMonth(yearMonth)) {
    return null;
  }

  const [yearText, monthText] = yearMonth.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = String(lastDayOfMonth(year, month)).padStart(2, '0');

  return { start: `${yearMonth}-01`, end: `${yearText}-${monthText}-${lastDay}` };
};

// 対象年月を検証する。YEAR_MONTH_PATTERN で桁が固定されるため、上限・下限の比較は
// 文字列の辞書順でそのまま成立する。
export const validateTargetMonth = (
  targetMonth: string,
  maxTargetMonth: string,
  options: ValidateTargetMonthOptions = {},
): TargetMonthValidationResult => {
  if (!targetMonth) {
    return { period: null, error: '対象年月を選択してください。' };
  }

  const period = toPeriodDates(targetMonth);
  if (!period) {
    return { period: null, error: '対象年月は年と月を正しく選択してください。' };
  }

  if (targetMonth < MIN_TARGET_MONTH) {
    return {
      period: null,
      error: `対象年月は${MIN_TARGET_MONTH_LABEL}以降を選択してください。`,
    };
  }

  const isAllowedFutureMonth =
    options.allowedFutureMonth != null && targetMonth === options.allowedFutureMonth;

  if (targetMonth > maxTargetMonth && !isAllowedFutureMonth) {
    return {
      period: null,
      error: '未来の対象年月は登録できません。当月以前を選択してください。',
    };
  }

  return { period, error: null };
};
