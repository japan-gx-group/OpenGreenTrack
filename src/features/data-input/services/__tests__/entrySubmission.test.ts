import { describe, expect, it } from 'vitest';
import {
  DECIMAL_PATTERN,
  VALIDATION_MESSAGES,
  amountValidationMessage,
  buildActivityEntryInput,
  parseValidAmount,
  validateAmount,
  validateEntry,
} from '../entrySubmission';

// 統合データ入力フォームの検証順序・文言と保存内容の組み立てを固定する。

const period = { start: '2024-11-01', end: '2024-11-30' };
const MISSING = '参照していた係数が削除されています。製品を再選択してください';

describe('parseValidAmount / DECIMAL_PATTERN', () => {
  it('半角数字と小数点のみ受け付け、0 より大きい値だけ数値にする', () => {
    expect(DECIMAL_PATTERN.test('12.5')).toBe(true);
    expect(DECIMAL_PATTERN.test('1.')).toBe(true);
    expect(DECIMAL_PATTERN.test('1,000')).toBe(false);
    expect(DECIMAL_PATTERN.test('１２')).toBe(false);
    expect(parseValidAmount('12.5')).toBe(12.5);
    expect(parseValidAmount('0')).toBeNull();
    expect(parseValidAmount('')).toBeNull();
    expect(parseValidAmount('.')).toBeNull();
    expect(parseValidAmount('abc')).toBeNull();
  });

  // activity_records.amount は numeric(15,3)。小数第 4 位以下は DB で 0.000 に丸まり、整数部 13 桁以上は overflow になる。
  it('numeric(15,3) に収まる桁数（整数部 12 桁・小数部 3 桁）だけを妥当とする', () => {
    expect(validateAmount('0.004')).toEqual({ kind: 'valid', value: 0.004 });
    expect(validateAmount('999999999999.999')).toEqual({ kind: 'valid', value: 999999999999.999 });
    expect(validateAmount('0.0004')).toEqual({ kind: 'too-precise' });
    expect(validateAmount('1.0001')).toEqual({ kind: 'too-precise' });
    expect(validateAmount('1000000000000')).toEqual({ kind: 'too-large' });
    expect(validateAmount('9999999999999999')).toEqual({ kind: 'too-large' });
    expect(validateAmount('0')).toEqual({ kind: 'invalid' });
    expect(validateAmount('')).toEqual({ kind: 'invalid' });
    expect(parseValidAmount('0.0004')).toBeNull();
    expect(parseValidAmount('1000000000000')).toBeNull();
  });

  it('値に影響しない先頭 0・末尾 0 は桁に数えない', () => {
    expect(validateAmount('0000000000001.5')).toEqual({ kind: 'valid', value: 1.5 });
    expect(validateAmount('1.2300')).toEqual({ kind: 'valid', value: 1.23 });
    expect(validateAmount('0.0010')).toEqual({ kind: 'valid', value: 0.001 });
  });

  it('検証結果ごとの文言を返す', () => {
    expect(amountValidationMessage({ kind: 'valid', value: 1 })).toBeNull();
    expect(amountValidationMessage({ kind: 'invalid' })).toBe('活動量は0より大きい半角数字で入力してください。');
    expect(amountValidationMessage({ kind: 'too-precise' })).toBe('活動量は小数第3位までで入力してください。');
    expect(amountValidationMessage({ kind: 'too-large' })).toBe(
      '活動量は整数部12桁以内（999,999,999,999 以下）で入力してください。',
    );
  });
});

describe('validateEntry', () => {
  const base = {
    locationId: 'loc-1',
    targetMonthError: null,
    amount: '10',
    note: '',
    factor: { source: 'standard' as const },
  };

  it('拠点 → 対象年月 → 活動量 → 備考 の順に最初のエラーを返す', () => {
    expect(validateEntry({ ...base, locationId: '' }, { factorMissing: MISSING })).toBe('拠点を選択してください。');
    expect(
      validateEntry({ ...base, locationId: '', targetMonthError: '未来の対象年月は登録できません。' }, { factorMissing: MISSING }),
    ).toBe('拠点を選択してください。');
    expect(validateEntry({ ...base, targetMonthError: '対象年月を選択してください。' }, { factorMissing: MISSING })).toBe(
      '対象年月を選択してください。',
    );
    expect(validateEntry({ ...base, amount: '0' }, { factorMissing: MISSING })).toBe(
      '活動量は0より大きい半角数字で入力してください。',
    );
    expect(validateEntry({ ...base, amount: '0.0004' }, { factorMissing: MISSING })).toBe(
      VALIDATION_MESSAGES.amountTooPrecise,
    );
    expect(validateEntry({ ...base, amount: '1000000000000' }, { factorMissing: MISSING })).toBe(
      VALIDATION_MESSAGES.amountTooLarge,
    );
    expect(validateEntry({ ...base, note: 'x'.repeat(501) }, { factorMissing: MISSING })).toBe(
      '備考は500文字以内で入力してください。',
    );
    expect(validateEntry({ ...base, note: 'x'.repeat(500) }, { factorMissing: MISSING })).toBeNull();
  });

  it('IDEA は製品の選択・詳細取得を活動量より先に検証し、参照切れなら専用文言を返す', () => {
    const idea = { source: 'idea' as const, productSelected: false, productReady: false, isFactorMissing: false, detailError: null };
    expect(validateEntry({ ...base, amount: '', factor: idea }, { factorMissing: MISSING })).toBe(
      'IDEA製品を検索して選択してください。',
    );
    expect(
      validateEntry({ ...base, factor: { ...idea, isFactorMissing: true } }, { factorMissing: MISSING }),
    ).toBe(MISSING);
    expect(
      validateEntry({ ...base, factor: { ...idea, productSelected: true, productReady: false } }, { factorMissing: MISSING }),
    ).toBe('IDEA製品を検索して選択してください。');
    expect(
      validateEntry(
        { ...base, factor: { ...idea, productSelected: true, productReady: true, detailError: '取得失敗' } },
        { factorMissing: MISSING },
      ),
    ).toBe('取得失敗');
    expect(
      validateEntry({ ...base, factor: { ...idea, productSelected: true, productReady: true } }, { factorMissing: MISSING }),
    ).toBeNull();
  });
});

describe('buildActivityEntryInput', () => {
  it('Scope1/2 は energyType と emissionFactorId、備考は trim して空なら null', () => {
    expect(
      buildActivityEntryInput({
        category: { kind: 'energy', energyType: 'electricity' },
        locationId: 'loc-1',
        period,
        amount: 10000,
        unit: 'MWh',
        note: '  ',
        emissionFactorId: 'fac-1',
        ideaFactorId: null,
      }),
    ).toEqual({
      kind: 'scope12',
      input: {
        locationId: 'loc-1',
        energyType: 'electricity',
        amount: 10000,
        unit: 'MWh',
        periodStart: '2024-11-01',
        periodEnd: '2024-11-30',
        note: null,
        emissionFactorId: 'fac-1',
      },
    });
  });

  it('Scope3 は scope3CategoryId と ideaFactorId。製品が無ければ組み立てない', () => {
    expect(
      buildActivityEntryInput({
        category: { kind: 'scope3', categoryId: 4 },
        locationId: 'loc-1',
        period,
        amount: 12.5,
        unit: 'kg',
        note: ' メモ ',
        emissionFactorId: 'ignored',
        ideaFactorId: 'idea-1',
      }),
    ).toEqual({
      kind: 'scope3',
      input: {
        locationId: 'loc-1',
        scope3CategoryId: 4,
        ideaFactorId: 'idea-1',
        amount: 12.5,
        unit: 'kg',
        periodStart: '2024-11-01',
        periodEnd: '2024-11-30',
        note: 'メモ',
      },
    });
    expect(
      buildActivityEntryInput({
        category: { kind: 'scope3', categoryId: 4 },
        locationId: 'loc-1',
        period,
        amount: 1,
        unit: 'kg',
        note: '',
        emissionFactorId: null,
        ideaFactorId: null,
      }),
    ).toBeNull();
  });
});
