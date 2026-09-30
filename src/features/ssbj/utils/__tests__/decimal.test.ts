import { describe, expect, it } from 'vitest';
import { formatDecimalForDisplay, isDecimalString } from '../decimal';

describe('isDecimalString', () => {
  it.each(['0', '12', '1234.567', '-3.5', '0.000001'])('%s は十進表記', value => {
    expect(isDecimalString(value)).toBe(true);
  });

  it.each(['', ' 1', '1 ', '1e3', '1,234', '１２', '.5', '5.', '+1', 'NaN', 'Infinity'])(
    '%s は十進表記ではない',
    value => {
      expect(isDecimalString(value)).toBe(false);
    },
  );

  it('数値型は受け付けない（丸めを避けるため文字列で受け渡す）', () => {
    expect(isDecimalString(12.5)).toBe(false);
  });
});

describe('formatDecimalForDisplay', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1234.567', '1,234.567'],
    ['-1234567.0010', '-1,234,567.0010'],
  ])('%s → %s（丸めない）', (value, expected) => {
    expect(formatDecimalForDisplay(value)).toBe(expected);
  });
});
