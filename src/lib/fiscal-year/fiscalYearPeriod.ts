export const DEFAULT_FISCAL_YEAR_START_MONTH = 4;

export type FiscalYearPeriod = {
  label: string;
  startDate: string;
  endDate: string;
};

export type FiscalYearDateRange = Pick<FiscalYearPeriod, 'startDate' | 'endDate'>;

const MONTHS_PER_YEAR = 12;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const normalizeFiscalYearStartMonth = (month: number | null | undefined): number =>
  typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= MONTHS_PER_YEAR
    ? month
    : DEFAULT_FISCAL_YEAR_START_MONTH;

const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const deriveFiscalYearPeriod = (
  startYear: number,
  fiscalYearStartMonth?: number | null,
): FiscalYearPeriod => {
  const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;

  return {
    label: `${startYear}年度`,
    startDate: `${startYear}-${pad2(startMonth)}-01`,
    endDate: `${endYear}-${pad2(endMonth)}-${pad2(lastDayOfMonth(endYear, endMonth))}`,
  };
};

// 指定時刻の日本時間での暦日（年・月・日）。
// 「今日」の判定はすべて日本時間で行う。サーバは UTC で動くことが多く、年度の切り替わり日
// （4月1日 0:00〜9:00 JST）に UTC の暦日で判定すると前年度扱いになってしまうため。
const getTokyoDateParts = (date: Date): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
};

// 指定時刻が属する会計年度の開始年を返す（例: 期首月4月なら 2026-03-15 → 2025、2026-04-01 → 2026）。
// 初期セットアップで「今日が属する年度」を自動作成するために使う。
//
// 「今日」は日本時間で判定する。サーバは UTC で動くことが多く、年度の切り替わり日
// （4月1日 0:00〜9:00 JST）に UTC の暦日で判定すると前年度を作ってしまうため。
export const getFiscalYearStartYearForDate = (
  date: Date,
  fiscalYearStartMonth?: number | null,
): number => {
  const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
  const { year, month } = getTokyoDateParts(date);
  return month >= startMonth ? year : year - 1;
};

// 指定時刻の日本時間での暦日を、fiscal_years の startDate / endDate と同じ 'YYYY-MM-DD' 形式で返す。
export const formatIsoDateInTokyo = (date: Date): string => {
  const { year, month, day } = getTokyoDateParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
};

// 年度行が「現在の年度」（今日が startDate〜endDate に含まれる）かを返す。
//
// 「現在」は DB のフラグではなく表示のたびに今日の日付から導出する。フラグで持つと、それを
// 立てる経路と年度が変わったときに倒す経路の両方が必要になり、更新し忘れれば表示が古いままになる。
// 日付から導けば実運用でもデモでも同じ挙動になる。
//
// startDate / endDate は 'YYYY-MM-DD' の固定桁なので文字列比較で日付の大小になる。
// 期間が重なる年度行（期首月変更後の重複など）があれば複数行が同時に「現在」になり得る。
export const isCurrentFiscalYear = (period: FiscalYearDateRange, now: Date = new Date()): boolean => {
  const today = formatIsoDateInTokyo(now);
  return period.startDate <= today && today <= period.endDate;
};

// 年度行が終了済み（今日が endDate より後）かを返す。
// 削減目標カードで「達成」「未達」を年度確定後に限って表示するために使う。累計実績と通年目標の
// 比較は年度が終わるまで確定しないため、期中は「枠内で推移中」などの途中経過の表現にする。
// isCurrentFiscalYear と同じく、今日は日本時間の暦日で判定する。
export const isFiscalYearEnded = (period: FiscalYearDateRange, now: Date = new Date()): boolean =>
  period.endDate < formatIsoDateInTokyo(now);

export const formatFiscalYearPeriod = (startDate: string, endDate: string): string => {
  const formatYearMonth = (date: string) => date.replaceAll('-', '/').slice(0, 7);
  return `${formatYearMonth(startDate)} - ${formatYearMonth(endDate)}`;
};

export const buildFiscalYearMonthLabels = (fiscalYearStartMonth?: number | null): string[] => {
  const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
  return Array.from({ length: MONTHS_PER_YEAR }, (_, index) => {
    const month = ((startMonth - 1 + index) % MONTHS_PER_YEAR) + 1;
    return `${month}月`;
  });
};

export const getFiscalYearMonthIndex = (
  periodStart: string,
  fiscalYearStartMonth?: number | null,
): number | null => {
  const month = Number(periodStart.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > MONTHS_PER_YEAR) return null;

  const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
  return (month - startMonth + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
};

export const getFiscalYearStartMonthFromDate = (startDate: string): number =>
  normalizeFiscalYearStartMonth(Number(startDate.slice(5, 7)));

export const parseFiscalYearStartYear = (fiscalYear: string): number => {
  if (!/^\d{4}$/.test(fiscalYear)) {
    throw new Error('年度の指定が不正です');
  }
  return Number(fiscalYear);
};

export const getPreviousFiscalYearPeriod = (
  period: FiscalYearDateRange,
): FiscalYearDateRange => {
  const startYear = Number(period.startDate.slice(0, 4));
  if (!Number.isInteger(startYear)) {
    throw new Error('年度期間の指定が不正です');
  }

  const previous = deriveFiscalYearPeriod(
    startYear - 1,
    getFiscalYearStartMonthFromDate(period.startDate),
  );
  return {
    startDate: previous.startDate,
    endDate: previous.endDate,
  };
};
