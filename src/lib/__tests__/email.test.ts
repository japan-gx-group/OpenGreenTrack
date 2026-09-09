import { describe, expect, it } from 'vitest';
import { isValidEmail } from '../email';

describe('isValidEmail', () => {
  it('一般的な形式は通す（前後の空白は無視する）', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('  first.last+tag@sub.example.co.jp  ')).toBe(true);
  });

  it('@ が無い・ドメインにドットが無い・空白を含むものは弾く', () => {
    expect(isValidEmail('taigasss')).toBe(false);
    expect(isValidEmail('user@localhost')).toBe(false);
    expect(isValidEmail('user @example.com')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});
