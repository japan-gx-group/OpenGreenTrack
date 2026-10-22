// 手動入力フォームの「対象年月」を算定期間（会計年度マスタ）に連動したプルダウンで
// 選ばせるための選択肢の組み立て（純関数・副作用なし）。
//
// ねらい: ネイティブの月ピッカーは 2000-01〜当月を自由に選べてしまい、係数が
// 収録されていない過去の月を選んで未算定になる事故が起きやすい。年度→月の2段プルダウン
// にして、登録済みの算定期間の月だけを選ばせる。
// 既存レコードがどの算定期間にも属さない場合（年度マスタ登録前の保存データの編集）は、
// その年月だけを「算定期間外」の選択肢として残し、表示・保存を壊さない。

import { nextYearMonth } from './manualEntryTargetMonth';

/** 会計年度の期間（開始日・終了日）。FiscalYearOption / FiscalYearRange のどちらも渡せる最小の構造。 */
export interface FiscalYearPeriod {
  startDate: string;
  endDate: string;
}

export interface TargetMonthFiscalYear extends FiscalYearPeriod {
  id: string;
  /** 年度セレクタの表示名（fiscal_years.label。例: 「2025年度」）。 */
  label: string;
}

export interface TargetMonthOption {
  /** YYYY-MM */
  value: string;
  /** 「2026年3月」形式（入力履歴の対象期間表記と統一）。 */
  label: string;
  /** 未来月（当月より後）は見せたうえで選ばせない。 */
  disabled: boolean;
}

export interface TargetMonthYearOption {
  /** fiscal_years.id。算定期間外の合成行だけ OUT_OF_RANGE_YEAR_VALUE。 */
  value: string;
  label: string;
}

export interface TargetMonthDropdownModel {
  /** 選べる月を1つ以上持つ年度（新しい順＝fiscalYears の並びのまま）。 */
  yearOptions: TargetMonthYearOption[];
  selectedYearValue: string;
  /** 選択中の年度に属する全月（期間外のときは対象の1ヶ月だけ）。 */
  monthOptions: TargetMonthOption[];
}

/** 対象年月がどの算定期間にも属さないときに年度セレクタへ出す合成行の値。 */
export const OUT_OF_RANGE_YEAR_VALUE = 'out-of-range';
const OUT_OF_RANGE_YEAR_LABEL = '算定期間外';

/** YYYY-MM → 「2026年3月」。 */
export const toYearMonthLabel = (yearMonth: string): string => {
  const [yearText, monthText] = yearMonth.split('-');
  return `${yearText}年${Number(monthText)}月`;
};

// 年度マスタの期間が壊れていても（逆転・異常に長い）UI が固まらないための上限。
// 正常な会計年度は12ヶ月で、これを超える期間はマスタ側の検証が許さない。
const MAX_MONTHS_PER_RANGE = 24;

/** 期間（YYYY-MM-DD 〜 YYYY-MM-DD）に含まれる月（YYYY-MM）を古い順に列挙する。 */
export const listYearMonthsInRange = (startDate: string, endDate: string): string[] => {
  const endMonth = endDate.slice(0, 7);
  let year = Number(startDate.slice(0, 4));
  let month = Number(startDate.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [];
  }

  const months: string[] = [];
  for (let i = 0; i < MAX_MONTHS_PER_RANGE; i += 1) {
    const current = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    if (current > endMonth) {
      break;
    }
    months.push(current);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
};

interface SelectableArgs {
  /** 当月（これより後は未来月として選択不可）。 */
  maxTargetMonth: string;
  /** 編集対象レコードが保存時点で持つ未来月。年月を変えない保存を許すため例外的に選択可。 */
  allowedFutureMonth?: string | null;
}

const isSelectableMonth = (yearMonth: string, args: SelectableArgs): boolean =>
  yearMonth <= args.maxTargetMonth || yearMonth === args.allowedFutureMonth;

const containsMonth = (fiscalYear: FiscalYearPeriod, yearMonth: string): boolean =>
  fiscalYear.startDate.slice(0, 7) <= yearMonth && yearMonth <= fiscalYear.endDate.slice(0, 7);

/**
 * 選べる月（当月以前。編集中の未来月は例外）を 1 つ以上持つ会計年度だけを残す（並びは保つ）。
 * 全月が未来の年度は、単月入力の年度セレクタにも一括入力の対象年度セレクタにも出さない。
 */
export const listSelectableFiscalYears = <T extends FiscalYearPeriod>(
  fiscalYears: T[],
  args: SelectableArgs,
): T[] =>
  fiscalYears.filter((fiscalYear) =>
    listYearMonthsInRange(fiscalYear.startDate, fiscalYear.endDate).some((month) =>
      isSelectableMonth(month, args),
    ),
  );

/**
 * 保存後に対象年月を送る先（翌月）。同一拠点の連続入力を「数量を打って保存」の繰り返しにするために使う。
 * 当月より後へは送らない。年度マスタに算定期間が登録されている組織では、どの算定期間にも属さない月へも
 * 送らない（翌年度が未登録のまま年度末の月を保存したとき、「算定期間外」の月へ進めて係数の無い入力を
 * 続けさせないため。その場合は現在の月に留まる）。年度マスタが空の組織は当月まで送る。送れないときは null。
 */
export const nextTargetMonthAfterSave = (args: {
  targetMonth: string;
  maxTargetMonth: string;
  fiscalYears: FiscalYearPeriod[];
}): string | null => {
  const next = nextYearMonth(args.targetMonth);
  if (next === null || next > args.maxTargetMonth) {
    return null;
  }
  if (args.fiscalYears.length > 0 && !args.fiscalYears.some((fiscalYear) => containsMonth(fiscalYear, next))) {
    return null;
  }
  return next;
};

/**
 * 対象年月プルダウン（年度＋月）の選択肢を組み立てる。
 * fiscalYears が空のときも、対象年月だけの合成選択肢を返す（取得中の表示用。
 * 取得後も空＝年度未登録の組織は、呼び出し側がネイティブの月入力へフォールバックする）。
 */
export const buildTargetMonthDropdown = (args: {
  fiscalYears: TargetMonthFiscalYear[];
  targetMonth: string;
  maxTargetMonth: string;
  allowedFutureMonth?: string | null;
}): TargetMonthDropdownModel => {
  const { fiscalYears, targetMonth } = args;

  const yearOptions: TargetMonthYearOption[] = listSelectableFiscalYears(fiscalYears, args).map(
    (fiscalYear) => ({ value: fiscalYear.id, label: fiscalYear.label }),
  );

  const selectedFiscalYear =
    fiscalYears.find(
      (fiscalYear) =>
        containsMonth(fiscalYear, targetMonth) &&
        yearOptions.some((option) => option.value === fiscalYear.id),
    ) ?? null;

  if (!selectedFiscalYear) {
    // どの算定期間にも属さない年月（年度マスタ登録前の既存レコードなど）。
    // 表示・保存を保てるよう、その1ヶ月だけを期間外の行として出す。
    return {
      yearOptions: [...yearOptions, { value: OUT_OF_RANGE_YEAR_VALUE, label: OUT_OF_RANGE_YEAR_LABEL }],
      selectedYearValue: OUT_OF_RANGE_YEAR_VALUE,
      monthOptions: [
        { value: targetMonth, label: `${toYearMonthLabel(targetMonth)}（${OUT_OF_RANGE_YEAR_LABEL}）`, disabled: false },
      ],
    };
  }

  return {
    yearOptions,
    selectedYearValue: selectedFiscalYear.id,
    monthOptions: listYearMonthsInRange(selectedFiscalYear.startDate, selectedFiscalYear.endDate).map(
      (month) => ({
        value: month,
        label: toYearMonthLabel(month),
        disabled: !isSelectableMonth(month, args),
      }),
    ),
  };
};

/**
 * 年度セレクタの切替先の年度で選ぶべき対象年月を返す。
 * 月（何月か）を保ったまま年度だけ差し替え、その月が切替先に無い・未来月で選べない場合は
 * 切替先で選べる最も新しい月へ倒す。選べる月が1つも無い年度は null（切替しない）。
 */
export const targetMonthForYearSwitch = (args: {
  fiscalYear: TargetMonthFiscalYear;
  currentTargetMonth: string;
  maxTargetMonth: string;
  allowedFutureMonth?: string | null;
}): string | null => {
  const selectable = listYearMonthsInRange(args.fiscalYear.startDate, args.fiscalYear.endDate).filter(
    (month) => isSelectableMonth(month, args),
  );
  if (selectable.length === 0) {
    return null;
  }

  const currentMonthOfYear = args.currentTargetMonth.slice(5, 7);
  return (
    selectable.find((month) => month.slice(5, 7) === currentMonthOfYear) ??
    selectable[selectable.length - 1]
  );
};
