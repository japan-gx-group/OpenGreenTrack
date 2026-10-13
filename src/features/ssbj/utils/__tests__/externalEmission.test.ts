import { describe, expect, it } from 'vitest';
import { fictionalExternalEmissions } from '../../__fixtures__/fictionalReport';
import {
  confirmedOnToTimestamp,
  emptyExternalEmissionForm,
  externalEmissionGasesLabel,
  externalEmissionLabel,
  isValidExternalEmissionSnapshot,
  normalizeExternalEmissionInput,
  timestampToConfirmedOn,
  validateExternalEmissionInput,
  type SsbjExternalEmissionFormValues,
} from '../externalEmission';

const PERIOD = { startDate: '2024-04-01', endDate: '2025-03-31' };
const filled = (overrides: Partial<SsbjExternalEmissionFormValues> = {}): SsbjExternalEmissionFormValues => ({
  ...emptyExternalEmissionForm(PERIOD, '2025-06-02'),
  scope: '1',
  gases: ['N2O', 'CH4'],
  value: ' 1.250 ',
  calculatedBy: ' 架空環境コンサルティング ',
  calculationMethod: '燃料の使用量×係数',
  evidenceId: 'evidence-1',
  confirmedByUserId: 'user-1',
  ...overrides,
});

describe('表示名', () => {
  it('Scope・基準・カテゴリと対象ガスを出す（ガスは 7 種類の順にそろえる）', () => {
    expect(externalEmissionLabel({ scope: 1, scope3CategoryId: null, scope2Basis: null })).toBe('Scope 1');
    expect(externalEmissionLabel({ scope: 2, scope3CategoryId: null, scope2Basis: 'location' })).toBe('Scope 2（ロケーション基準）');
    expect(externalEmissionLabel({ scope: 3, scope3CategoryId: 4, scope2Basis: null })).toMatch(/^Scope 3 カテゴリ 4：/);
    expect(externalEmissionGasesLabel(['N2O', 'CH4'])).toBe('CH4・N2O');
  });
});

describe('normalizeExternalEmissionInput', () => {
  it('前後の空白を除き、Scope に関係しない欄は空にし、確認した日を日本時間の 0 時にする', () => {
    const input = normalizeExternalEmissionInput(filled({ scope3CategoryId: '4', scope2Basis: 'market', internalNote: '  ' }));
    expect(input).toMatchObject({
      scope: 1, scope3CategoryId: null, scope2Basis: null, gases: ['CH4', 'N2O'], value: '1.250',
      calculatedBy: '架空環境コンサルティング', confirmedAt: '2025-06-02T00:00:00+09:00', internalNote: null,
      period: PERIOD,
    });
  });

  it('確認した日 ⇔ 確認日時は日本時間で行き来する', () => {
    expect(timestampToConfirmedOn(confirmedOnToTimestamp('2025-06-02'))).toBe('2025-06-02');
    expect(timestampToConfirmedOn('2025-06-01T15:00:00.000Z')).toBe('2025-06-02');
  });
});

describe('validateExternalEmissionInput', () => {
  it('必須項目がそろえば保存できる', () => {
    expect(validateExternalEmissionInput(normalizeExternalEmissionInput(filled()))).toEqual([]);
  });

  it.each([
    [{ scope: '' as const }, 'Scope を選んでください'],
    [{ scope: '3' as const }, 'Scope 3 のカテゴリを選んでください'],
    [{ scope: '2' as const }, 'Scope 2 の基準'],
    [{ gases: [] }, '対象ガスを 1 つ以上'],
    [{ value: '1,250' }, '0 以上の数値'],
    [{ value: '-1' }, '0 以上の数値'],
    [{ periodEnd: '2024-03-31' }, '期間の終わりは、始まりと同じ日かそれより後'],
    [{ calculatedBy: ' ' }, '算定した者'],
    [{ calculationMethod: '' }, '算定方法'],
    [{ evidenceId: '' }, '根拠文書を選んでください'],
    [{ confirmedByUserId: '' }, '確認者を選んでください'],
    [{ confirmedOn: '' }, '確認した日'],
  ])('%o が足りない・正しくないときは保存しない（%s）', (overrides, message) => {
    const errors = validateExternalEmissionInput(normalizeExternalEmissionInput(filled(overrides)));
    expect(errors.join('。')).toContain(message);
  });
});

describe('isValidExternalEmissionSnapshot', () => {
  it('架空の保存版の値は正しい。形が崩れた値は正しくない', () => {
    expect(fictionalExternalEmissions.every(isValidExternalEmissionSnapshot)).toBe(true);
    const [item] = fictionalExternalEmissions;
    expect(isValidExternalEmissionSnapshot({ ...item, value: '1e3' })).toBe(false);
    expect(isValidExternalEmissionSnapshot({ ...item, gases: ['H2O'] })).toBe(false);
    expect(isValidExternalEmissionSnapshot({ ...item, scope: 3, scope3CategoryId: null })).toBe(false);
    expect(isValidExternalEmissionSnapshot({ ...item, scope: 2, scope2Basis: null })).toBe(false);
  });
});
