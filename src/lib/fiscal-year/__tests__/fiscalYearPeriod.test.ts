import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  buildFiscalYearMonthLabels,
  deriveFiscalYearPeriod,
  formatFiscalYearPeriod,
  formatIsoDateInTokyo,
  getPreviousFiscalYearPeriod,
  getFiscalYearMonthIndex,
  getFiscalYearStartYearForDate,
  isCurrentFiscalYear,
  isFiscalYearEnded,
  normalizeFiscalYearStartMonth,
  parseFiscalYearStartYear,
} from '../fiscalYearPeriod';

describe('deriveFiscalYearPeriod', () => {
  it('未設定の場合は従来どおり4月始まりで年度期間を作る', () => {
    expect(deriveFiscalYearPeriod(2026, null)).toEqual({
      label: '2026年度',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });
  });

  it('1月始まりの場合は同じ暦年の12月末で年度を閉じる', () => {
    expect(deriveFiscalYearPeriod(2026, 1)).toEqual({
      label: '2026年度',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
  });

  it('7月始まりの場合は翌年6月末で年度を閉じる', () => {
    expect(deriveFiscalYearPeriod(2026, 7)).toEqual({
      label: '2026年度',
      startDate: '2026-07-01',
      endDate: '2027-06-30',
    });
  });

  it('2月始まりの場合は翌年1月末で年度を閉じる', () => {
    expect(deriveFiscalYearPeriod(2026, 2)).toEqual({
      label: '2026年度',
      startDate: '2026-02-01',
      endDate: '2027-01-31',
    });
  });
});

describe('getFiscalYearStartYearForDate', () => {
  it('期首月以降の日付は同じ暦年の年度に属する', () => {
    expect(getFiscalYearStartYearForDate(new Date('2026-04-01T00:00:00+09:00'), 4)).toBe(2026);
    expect(getFiscalYearStartYearForDate(new Date('2026-12-31T23:59:59+09:00'), 4)).toBe(2026);
  });

  it('期首月より前の日付は前年の年度に属する', () => {
    expect(getFiscalYearStartYearForDate(new Date('2026-03-31T23:59:59+09:00'), 4)).toBe(2025);
    expect(getFiscalYearStartYearForDate(new Date('2026-01-01T00:00:00+09:00'), 4)).toBe(2025);
  });

  it('1月始まりなら常に暦年と一致する', () => {
    expect(getFiscalYearStartYearForDate(new Date('2026-01-01T00:00:00+09:00'), 1)).toBe(2026);
    expect(getFiscalYearStartYearForDate(new Date('2026-12-31T23:59:59+09:00'), 1)).toBe(2026);
  });

  it('期首月が未設定なら4月始まりとして扱う', () => {
    expect(getFiscalYearStartYearForDate(new Date('2026-03-31T12:00:00+09:00'), null)).toBe(2025);
    expect(getFiscalYearStartYearForDate(new Date('2026-04-01T12:00:00+09:00'), null)).toBe(2026);
  });

  // サーバが UTC で動いていても、年度の切り替わりは日本時間の暦日で判定する。
  it('UTC ではまだ3月31日でも日本時間で4月1日なら新年度に属する', () => {
    // 2026-03-31T15:00:00Z = 2026-04-01T00:00:00+09:00
    expect(getFiscalYearStartYearForDate(new Date('2026-03-31T15:00:00Z'), 4)).toBe(2026);
    // 2026-03-31T14:59:59Z = 2026-03-31T23:59:59+09:00
    expect(getFiscalYearStartYearForDate(new Date('2026-03-31T14:59:59Z'), 4)).toBe(2025);
  });
});

describe('formatIsoDateInTokyo', () => {
  it('日本時間の暦日を YYYY-MM-DD で返す（UTC の暦日ではない）', () => {
    // 2026-03-31T15:00:00Z = 2026-04-01T00:00:00+09:00
    expect(formatIsoDateInTokyo(new Date('2026-03-31T15:00:00Z'))).toBe('2026-04-01');
    expect(formatIsoDateInTokyo(new Date('2026-03-31T14:59:59Z'))).toBe('2026-03-31');
  });

  it('月・日を2桁にそろえる', () => {
    expect(formatIsoDateInTokyo(new Date('2026-01-05T03:00:00+09:00'))).toBe('2026-01-05');
  });
});

describe('isCurrentFiscalYear', () => {
  const fy2026 = { startDate: '2026-04-01', endDate: '2027-03-31' };

  it('今日が期間内なら現在の年度', () => {
    expect(isCurrentFiscalYear(fy2026, new Date('2026-09-07T03:00:00+09:00'))).toBe(true);
  });

  it('開始日・終了日は期間に含む', () => {
    expect(isCurrentFiscalYear(fy2026, new Date('2026-04-01T00:00:00+09:00'))).toBe(true);
    expect(isCurrentFiscalYear(fy2026, new Date('2027-03-31T23:59:59+09:00'))).toBe(true);
  });

  it('期間の前後は現在の年度ではない', () => {
    expect(isCurrentFiscalYear(fy2026, new Date('2026-03-31T23:59:59+09:00'))).toBe(false);
    expect(isCurrentFiscalYear(fy2026, new Date('2027-04-01T00:00:00+09:00'))).toBe(false);
  });

  // 年度の切り替わり日は日本時間で判定する（UTC の暦日で見ると前日になる時間帯）。
  it('UTC ではまだ3月31日でも日本時間で4月1日なら新年度が現在になる', () => {
    const fy2025 = { startDate: '2025-04-01', endDate: '2026-03-31' };
    const now = new Date('2026-03-31T15:00:00Z'); // 2026-04-01T00:00:00+09:00
    expect(isCurrentFiscalYear(fy2026, now)).toBe(true);
    expect(isCurrentFiscalYear(fy2025, now)).toBe(false);
  });

  it('1月始まりの年度でも判定できる', () => {
    const fy2026Jan = { startDate: '2026-01-01', endDate: '2026-12-31' };
    expect(isCurrentFiscalYear(fy2026Jan, new Date('2026-12-31T12:00:00+09:00'))).toBe(true);
    expect(isCurrentFiscalYear(fy2026Jan, new Date('2027-01-01T12:00:00+09:00'))).toBe(false);
  });
});

describe('isFiscalYearEnded', () => {
  const fy2026 = { startDate: '2026-04-01', endDate: '2027-03-31' };

  it('終了日を過ぎていれば終了済み', () => {
    expect(isFiscalYearEnded(fy2026, new Date('2027-04-01T00:00:00+09:00'))).toBe(true);
  });

  it('期中・終了日当日・開始前は終了していない', () => {
    expect(isFiscalYearEnded(fy2026, new Date('2026-09-08T12:00:00+09:00'))).toBe(false);
    expect(isFiscalYearEnded(fy2026, new Date('2027-03-31T23:59:59+09:00'))).toBe(false);
    expect(isFiscalYearEnded(fy2026, new Date('2026-03-31T12:00:00+09:00'))).toBe(false);
  });

  // 終了判定も日本時間で行う（UTC ではまだ 3/31 の時間帯でも JST で 4/1 なら終了済み）。
  it('UTC ではまだ終了日でも日本時間で翌日なら終了済み', () => {
    expect(isFiscalYearEnded(fy2026, new Date('2027-03-31T15:00:00Z'))).toBe(true);
  });
});

describe('normalizeFiscalYearStartMonth', () => {
  it('1〜12以外は4月にフォールバックする', () => {
    expect(normalizeFiscalYearStartMonth(0)).toBe(DEFAULT_FISCAL_YEAR_START_MONTH);
    expect(normalizeFiscalYearStartMonth(13)).toBe(DEFAULT_FISCAL_YEAR_START_MONTH);
    expect(normalizeFiscalYearStartMonth(null)).toBe(DEFAULT_FISCAL_YEAR_START_MONTH);
  });
});

describe('buildFiscalYearMonthLabels', () => {
  it('期首月から12か月分のラベルを並べる', () => {
    expect(buildFiscalYearMonthLabels(7)).toEqual([
      '7月',
      '8月',
      '9月',
      '10月',
      '11月',
      '12月',
      '1月',
      '2月',
      '3月',
      '4月',
      '5月',
      '6月',
    ]);
  });
});

describe('getFiscalYearMonthIndex', () => {
  it('指定した期首月を0番目として月の位置を返す', () => {
    expect(getFiscalYearMonthIndex('2026-07-01', 7)).toBe(0);
    expect(getFiscalYearMonthIndex('2027-01-01', 7)).toBe(6);
    expect(getFiscalYearMonthIndex('2027-06-30', 7)).toBe(11);
  });

  it('月として解釈できない文字列は null を返す', () => {
    expect(getFiscalYearMonthIndex('', 7)).toBeNull();
    expect(getFiscalYearMonthIndex('2026-13-01', 7)).toBeNull();
    expect(getFiscalYearMonthIndex('invalid', 7)).toBeNull();
  });
});

describe('formatFiscalYearPeriod', () => {
  it('画面表示用にYYYY/MM - YYYY/MMへ整形する', () => {
    expect(formatFiscalYearPeriod('2026-07-01', '2027-06-30')).toBe('2026/07 - 2027/06');
  });
});

describe('parseFiscalYearStartYear', () => {
  it('4桁の年度だけを数値化する', () => {
    expect(parseFiscalYearStartYear('2026')).toBe(2026);
    expect(() => parseFiscalYearStartYear('')).toThrow('年度の指定が不正です');
    expect(() => parseFiscalYearStartYear('26')).toThrow('年度の指定が不正です');
  });
});

describe('getPreviousFiscalYearPeriod', () => {
  it('現在年度と同じ期首月で前年度期間を作る', () => {
    expect(getPreviousFiscalYearPeriod({
      startDate: '2026-07-01',
      endDate: '2027-06-30',
    })).toEqual({
      startDate: '2025-07-01',
      endDate: '2026-06-30',
    });
  });
});
