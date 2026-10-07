import { describe, expect, it } from 'vitest';
import {
  getCurrentYearMonth,
  toMonthlyPeriodLabel,
  toPeriodDates,
  validateTargetMonth,
} from '../manualEntryTargetMonth';

describe('manualEntryTargetMonth', () => {
  it('現在年月をYYYY-MM形式で返す', () => {
    expect(getCurrentYearMonth(new Date(2026, 6, 28))).toBe('2026-07');
  });

  it('対象年月から月初と月末を返す', () => {
    expect(toPeriodDates('2026-07')).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(toPeriodDates('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(toPeriodDates('2025-02')).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    // Date 経由だと 2桁年が 1999 年扱いになるため、文字列変換であることを固定する。
    expect(toPeriodDates('0099-02')).toEqual({ start: '0099-02-01', end: '0099-02-28' });
  });

  it('不正な年月形式はnullを返す', () => {
    expect(toPeriodDates('2026-13')).toBeNull();
    expect(toPeriodDates('2026-00')).toBeNull();
    expect(toPeriodDates('2026/07')).toBeNull();
    expect(toPeriodDates('')).toBeNull();
  });

  it('月初〜月末に一致する期間を「2026年3月」表記にする', () => {
    expect(toMonthlyPeriodLabel('2026-03-01', '2026-03-31')).toBe('2026年3月');
    expect(toMonthlyPeriodLabel('2026-11-01', '2026-11-30')).toBe('2026年11月');
    expect(toMonthlyPeriodLabel('2024-02-01', '2024-02-29')).toBe('2024年2月');
  });

  it('月初〜月末に一致しない期間はnullを返す（呼び出し側が範囲表記へ落とす）', () => {
    expect(toMonthlyPeriodLabel('2026-03-02', '2026-03-31')).toBeNull();
    expect(toMonthlyPeriodLabel('2026-03-01', '2026-03-30')).toBeNull();
    expect(toMonthlyPeriodLabel('2026-03-01', '2026-04-30')).toBeNull();
    expect(toMonthlyPeriodLabel('2025-02-01', '2025-02-29')).toBeNull();
    expect(toMonthlyPeriodLabel('', '')).toBeNull();
  });

  it('未入力・不正形式を保存前エラーにする', () => {
    expect(validateTargetMonth('', '2026-07')).toEqual({
      period: null,
      error: '対象年月を選択してください。',
    });
    expect(validateTargetMonth('2026-13', '2026-07')).toEqual({
      period: null,
      error: '対象年月は年と月を正しく選択してください。',
    });
  });

  it('未来月を保存前エラーにし、期間を返さない', () => {
    expect(validateTargetMonth('2026-08', '2026-07')).toEqual({
      period: null,
      error: '未来の対象年月は登録できません。当月以前を選択してください。',
    });
  });

  it('下限より古い年月を保存前エラーにする', () => {
    expect(validateTargetMonth('1999-12', '2026-07')).toEqual({
      period: null,
      error: '対象年月は2000年1月以降を選択してください。',
    });
    expect(validateTargetMonth('0099-02', '2026-07').error).toBe(
      '対象年月は2000年1月以降を選択してください。',
    );
    expect(validateTargetMonth('2000-01', '2026-07').error).toBeNull();
  });

  it('編集中レコードの元の未来月はそのままなら許可する', () => {
    expect(validateTargetMonth('2030-01', '2026-07', { allowedFutureMonth: '2030-01' })).toEqual({
      period: { start: '2030-01-01', end: '2030-01-31' },
      error: null,
    });
    // 元の年月から別の未来月へ変更するのは許可しない。
    expect(validateTargetMonth('2030-02', '2026-07', { allowedFutureMonth: '2030-01' }).error).toBe(
      '未来の対象年月は登録できません。当月以前を選択してください。',
    );
  });

  it('当月以前はエラーにしない', () => {
    expect(validateTargetMonth('2026-07', '2026-07')).toEqual({
      period: { start: '2026-07-01', end: '2026-07-31' },
      error: null,
    });
    expect(validateTargetMonth('2026-06', '2026-07').error).toBeNull();
  });
});
