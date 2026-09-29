import { describe, expect, it } from 'vitest';
import { fictionalTimeHorizonDefinitions } from '../../__fixtures__/fictionalReport';
import {
  EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS,
  normalizeSsbjTimeHorizonInput,
  toSsbjTimeHorizonFormValues,
  validateSsbjTimeHorizonInput,
} from '../timeHorizons';

describe('normalizeSsbjTimeHorizonInput', () => {
  it('入力済みの欄は前後の空白を落とし、それ以外の欄は本文を捨てる', () => {
    const values = toSsbjTimeHorizonFormValues(EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS);
    const input = normalizeSsbjTimeHorizonInput({
      ...values,
      shortTerm: { state: 'answered', text: '  3年以内  ' },
      mediumTerm: { state: 'unconfirmed', text: '確認中の下書き' },
      internalNote: '   ',
    });
    expect(input.shortTerm).toEqual({ state: 'answered', value: '3年以内' });
    expect(input.mediumTerm).toEqual({ state: 'unconfirmed' });
    expect(input.internalNote).toBeNull();
  });

  it('保存済みの定義をフォームへ戻して正規化すると元に戻る', () => {
    expect(normalizeSsbjTimeHorizonInput(toSsbjTimeHorizonFormValues(fictionalTimeHorizonDefinitions))).toEqual(
      fictionalTimeHorizonDefinitions,
    );
  });
});

describe('validateSsbjTimeHorizonInput', () => {
  it('入力済みなのに本文が空の欄はエラー', () => {
    const errors = validateSsbjTimeHorizonInput({
      ...EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS,
      longTerm: { state: 'answered', value: '' },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('「長期」の定義を入力してください');
  });

  it('上限を超える本文はエラー', () => {
    const errors = validateSsbjTimeHorizonInput({
      ...EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS,
      planningHorizonRelation: { state: 'answered', value: 'あ'.repeat(2001) },
    });
    expect(errors).toEqual(['定義と戦略上の計画期間との関係は2000文字以内で入力してください']);
  });

  it('未入力の定義・架空データは検証を通る', () => {
    expect(validateSsbjTimeHorizonInput(EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS)).toEqual([]);
    expect(validateSsbjTimeHorizonInput(fictionalTimeHorizonDefinitions)).toEqual([]);
  });
});
