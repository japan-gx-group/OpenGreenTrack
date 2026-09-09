import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../datetime';

describe('formatDateTime', () => {
  it('YYYY/MM/DD HH:mm 形式に整形する', () => {
    // ローカルタイムに依存しないよう、ローカルの Date から期待値を組み立てる
    const d = new Date(2026, 6, 16, 9, 5);
    expect(formatDateTime(d.toISOString())).toBe('2026/07/16 09:05');
  });

  it('不正な日時は入力をそのまま返す', () => {
    expect(formatDateTime('invalid')).toBe('invalid');
  });
});
