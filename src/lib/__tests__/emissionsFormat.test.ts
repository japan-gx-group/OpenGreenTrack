import { describe, expect, it } from 'vitest';
import { formatEmissionsNumber } from '../emissionsFormat';

describe('formatEmissionsNumber（summary）', () => {
  it('0 は小数なしの 0 で表示する', () => {
    expect(formatEmissionsNumber(0)).toBe('0');
    expect(formatEmissionsNumber(-0)).toBe('0');
  });

  it('0 ではない微小値は範囲で表示する', () => {
    expect(formatEmissionsNumber(0.000001)).toBe('<0.1');
    expect(formatEmissionsNumber(0.04)).toBe('<0.1');
    expect(formatEmissionsNumber(-0.000001)).toBe('>-0.1');
    expect(formatEmissionsNumber(-0.04)).toBe('>-0.1');
    expect(formatEmissionsNumber(-0.049)).toBe('>-0.1');
    expect(formatEmissionsNumber(0.049)).toBe('<0.1');
    expect(formatEmissionsNumber(0.05)).toBe('0.1');
    expect(formatEmissionsNumber(-0.05)).toBe('-0.1');
    expect(formatEmissionsNumber(0.051)).toBe('0.1');
    expect(formatEmissionsNumber(-0.051)).toBe('-0.1');
  });

  it('100 未満は小数1桁にそろえる（末尾のゼロも出す）', () => {
    expect(formatEmissionsNumber(5)).toBe('5.0');
    expect(formatEmissionsNumber(12.5)).toBe('12.5');
    expect(formatEmissionsNumber(90.37)).toBe('90.4');
    expect(formatEmissionsNumber(99.94)).toBe('99.9');
  });

  it('小数1桁に丸めて 100 になる値は整数で表示する', () => {
    expect(formatEmissionsNumber(99.96)).toBe('100');
  });

  it('100 以上は整数にして、カンマで区切る', () => {
    expect(formatEmissionsNumber(100)).toBe('100');
    expect(formatEmissionsNumber(903.7)).toBe('904');
    expect(formatEmissionsNumber(30690.594)).toBe('30,691');
    expect(formatEmissionsNumber(87717.997)).toBe('87,718');
  });

  it('負の値も絶対値で判定する', () => {
    expect(formatEmissionsNumber(-5)).toBe('-5.0');
    expect(formatEmissionsNumber(-99.94)).toBe('-99.9');
    expect(formatEmissionsNumber(-99.96)).toBe('-100');
    expect(formatEmissionsNumber(-100)).toBe('-100');
    expect(formatEmissionsNumber(-1234.5)).toBe('-1,235');
  });

  it('precision を省略した場合は summary と同じ', () => {
    expect(formatEmissionsNumber(30690.594, { precision: 'summary' })).toBe('30,691');
    expect(formatEmissionsNumber(0.04, { precision: 'summary' })).toBe(formatEmissionsNumber(0.04));
  });
});

describe('formatEmissionsNumber（detail）', () => {
  it('小数3桁固定で表示し、末尾のゼロも出す', () => {
    expect(formatEmissionsNumber(30690.594, { precision: 'detail' })).toBe('30,690.594');
    expect(formatEmissionsNumber(903.7, { precision: 'detail' })).toBe('903.700');
    expect(formatEmissionsNumber(26529, { precision: 'detail' })).toBe('26,529.000');
    expect(formatEmissionsNumber(12.3456, { precision: 'detail' })).toBe('12.346');
    expect(formatEmissionsNumber(0.04, { precision: 'detail' })).toBe('0.040');
    expect(formatEmissionsNumber(0, { precision: 'detail' })).toBe('0.000');
    expect(formatEmissionsNumber(-903.7, { precision: 'detail' })).toBe('-903.700');
    expect(formatEmissionsNumber(0.000499, { precision: 'detail' })).toBe('0.000');
    expect(formatEmissionsNumber(0.0005, { precision: 'detail' })).toBe('0.001');
  });

  it('0.000 に丸まる負の値は符号を付けずに 0.000 と表示する', () => {
    expect(formatEmissionsNumber(-0, { precision: 'detail' })).toBe('0.000');
    expect(formatEmissionsNumber(-1e-12, { precision: 'detail' })).toBe('0.000');
    expect(formatEmissionsNumber(-0.000499, { precision: 'detail' })).toBe('0.000');
    expect(formatEmissionsNumber(-0.0005, { precision: 'detail' })).toBe('-0.001');
  });
});
