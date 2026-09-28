import { describe, expect, it } from 'vitest';
import type { SsbjFieldValue } from '../../types';
import {
  fieldStateLabel,
  formatFieldValue,
  fromFieldValue,
  isAnswered,
  isSsbjFieldState,
  toFieldValue,
} from '../fieldValue';

describe('0 と未入力の区別', () => {
  it('回答済みの "0" は値として表示され、未入力は「未入力」と表示される', () => {
    const zero: SsbjFieldValue<string> = { state: 'answered', value: '0' };
    const empty: SsbjFieldValue<string> = { state: 'unanswered' };

    expect(formatFieldValue(zero)).toBe('0');
    expect(formatFieldValue(empty)).toBe('未入力');
    expect(isAnswered(zero)).toBe(true);
    expect(isAnswered(empty)).toBe(false);
  });

  it('DB の値 "0" は回答済みの 0 として読み込まれる（falsy 扱いで未入力にならない）', () => {
    expect(toFieldValue('answered', '0')).toEqual({ state: 'answered', value: '0' });
    expect(toFieldValue('answered', 0)).toEqual({ state: 'answered', value: 0 });
  });
});

describe('fieldStateLabel', () => {
  it.each([
    ['unanswered', '未入力'],
    ['unconfirmed', '未確認'],
    ['not_applicable', '非該当'],
    ['answered', '入力済み'],
  ] as const)('%s → %s', (state, label) => {
    expect(fieldStateLabel(state)).toBe(label);
  });

  it('どの状態のラベルも「0」「なし」「-」や空文字にならない', () => {
    for (const state of ['unanswered', 'unconfirmed', 'not_applicable', 'answered'] as const) {
      expect(['0', 'なし', '-', '']).not.toContain(fieldStateLabel(state));
    }
  });
});

describe('formatFieldValue', () => {
  it('回答済みの値は format で整形し、それ以外は状態ラベルを返す', () => {
    const format = (value: string) => `${value} t-CO2e`;
    expect(formatFieldValue({ state: 'answered', value: '12.5' }, format)).toBe('12.5 t-CO2e');
    expect(formatFieldValue({ state: 'not_applicable' }, format)).toBe('非該当');
    expect(formatFieldValue({ state: 'unconfirmed' }, format)).toBe('未確認');
  });
});

describe('toFieldValue（DB 行 → 型）', () => {
  it('値を持たない状態はそのまま組み立てる', () => {
    expect(toFieldValue('unanswered', null)).toEqual({ state: 'unanswered' });
    expect(toFieldValue('unconfirmed', undefined)).toEqual({ state: 'unconfirmed' });
    expect(toFieldValue('not_applicable', null)).toEqual({ state: 'not_applicable' });
  });

  it('回答済みなのに値が無い行は例外にする', () => {
    expect(() => toFieldValue('answered', null)).toThrow('値がありません');
  });

  it('回答済みで空白だけの文字列は例外にする（空文字を回答として残さない）', () => {
    expect(() => toFieldValue('answered', '   ')).toThrow('値が空です');
  });

  it('未入力・未確認・非該当なのに値がある行は例外にする', () => {
    expect(() => toFieldValue('unanswered', '0')).toThrow('未入力の項目に値が入っています');
    expect(() => toFieldValue('unconfirmed', 'x')).toThrow('未確認の項目に値が入っています');
    expect(() => toFieldValue('not_applicable', 0)).toThrow('非該当の項目に値が入っています');
  });

  it('不明な状態は例外にする', () => {
    expect(() => toFieldValue('zero', null)).toThrow('不明な入力状態です');
    expect(() => toFieldValue(null, null)).toThrow('不明な入力状態です');
  });
});

describe('fromFieldValue（型 → DB 行）', () => {
  it('回答済みは値を、それ以外は null を返す', () => {
    expect(fromFieldValue({ state: 'answered', value: '0' })).toEqual({ state: 'answered', value: '0' });
    expect(fromFieldValue({ state: 'not_applicable' })).toEqual({ state: 'not_applicable', value: null });
  });

  it('toFieldValue と往復しても変わらない', () => {
    const values: SsbjFieldValue<string>[] = [
      { state: 'answered', value: '0' },
      { state: 'unanswered' },
      { state: 'unconfirmed' },
      { state: 'not_applicable' },
    ];
    for (const value of values) {
      const row = fromFieldValue(value);
      expect(toFieldValue(row.state, row.value)).toEqual(value);
    }
  });
});

describe('isSsbjFieldState', () => {
  it('4 状態だけを受け付ける', () => {
    expect(isSsbjFieldState('answered')).toBe(true);
    expect(isSsbjFieldState('empty')).toBe(false);
    expect(isSsbjFieldState(0)).toBe(false);
  });
});
