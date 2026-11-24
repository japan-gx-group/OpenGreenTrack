import { describe, expect, it } from 'vitest';
import { formatEmissionsAxisTick, formatEmissionsTooltipValue } from '../emissionsChartFormat';

describe('formatEmissionsTooltipValue', () => {
  it('KPI カードと同じ要約表示にする（100 以上は整数）', () => {
    expect(formatEmissionsTooltipValue(30690.594)).toBe('30,691');
  });

  it('100 未満は小数1桁にする', () => {
    expect(formatEmissionsTooltipValue(45.26)).toBe('45.3');
  });

  it('0 と微小値を区別する', () => {
    expect(formatEmissionsTooltipValue(0)).toBe('0');
    expect(formatEmissionsTooltipValue(0.01)).toBe('<0.1');
    expect(formatEmissionsTooltipValue(-0.01)).toBe('>-0.1');
  });

  it('未記録の月（null / undefined）は「データなし」にする', () => {
    expect(formatEmissionsTooltipValue(null)).toBe('データなし');
    expect(formatEmissionsTooltipValue(undefined)).toBe('データなし');
  });
});

describe('formatEmissionsAxisTick', () => {
  it('大きな目盛りはカンマ区切りの整数にする', () => {
    expect(formatEmissionsAxisTick(30000)).toBe('30,000');
  });

  it('100 未満の目盛りに末尾のゼロを付けない', () => {
    expect(formatEmissionsAxisTick(25)).toBe('25');
  });

  it('小さな目盛りを「<0.1」に潰さず区別して出す', () => {
    expect(formatEmissionsAxisTick(0)).toBe('0');
    expect(formatEmissionsAxisTick(0.02)).toBe('0.02');
    expect(formatEmissionsAxisTick(0.04)).toBe('0.04');
  });
});
