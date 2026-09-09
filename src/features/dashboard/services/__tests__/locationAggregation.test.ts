import { describe, expect, it } from 'vitest';
import { calculateDiffPercent, getMonthIndex, toNumber } from '../locationAggregation';

describe('getMonthIndex', () => {
  it('年度内インデックス（4月=0 … 3月=11）を返す', () => {
    expect(getMonthIndex('2024-04-01')).toBe(0);
    expect(getMonthIndex('2024-12-01')).toBe(8);
    expect(getMonthIndex('2025-01-01')).toBe(9);
    expect(getMonthIndex('2025-03-31')).toBe(11);
  });

  it('期首月を渡すとその月を0番目として返す', () => {
    expect(getMonthIndex('2024-07-01', 7)).toBe(0);
    expect(getMonthIndex('2025-01-01', 7)).toBe(6);
    expect(getMonthIndex('2025-06-30', 7)).toBe(11);
  });

  it('月として解釈できない文字列は null を返す', () => {
    expect(getMonthIndex('')).toBeNull();
    expect(getMonthIndex('2024-13-01')).toBeNull();
    expect(getMonthIndex('invalid')).toBeNull();
  });
});

describe('calculateDiffPercent', () => {
  it('前年比（%）を返す', () => {
    expect(calculateDiffPercent(110, 100)).toBe(10);
    expect(calculateDiffPercent(90, 100)).toBe(-10);
  });

  it('前年が0（実質データなし）の場合は比較不能として null を返す', () => {
    expect(calculateDiffPercent(100, 0)).toBeNull();
  });
});

describe('toNumber', () => {
  it('数値文字列・null を安全に数値化する', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(3)).toBe(3);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('not-a-number')).toBe(0);
  });
});
