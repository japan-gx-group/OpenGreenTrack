import { describe, expect, it } from 'vitest';
import { findPortableSchemaProblems } from '@/lib/ai/schema';
import type { InvoiceExtraction } from '../../types';
import { buildFuelCandidates, buildProviderCandidates } from '../factorCandidates';
import {
  FACTOR_MATCHING_SCHEMA,
  buildMatchingInput,
  validateFactorMatching,
  type MatchingTarget,
} from '../factorMatching';

const extraction: InvoiceExtraction = {
  kind: 'electricity',
  supplierName: '東京電力エナジーパートナー株式会社',
  supplierRegistrationNumber: 'A0269',
  supplyAddress: '東京都架空区架空町1-1-1',
  items: [],
  warnings: [],
};

const electricityTarget: MatchingTarget = {
  index: 1,
  item: {
    kind: 'electricity',
    planName: 'スタンダードS',
    fuelName: null,
    usageMonth: '2025-09',
    periodStart: null,
    periodEnd: null,
    amount: 12345,
    unit: 'kWh',
  },
  candidates: buildProviderCandidates({
    energyType: 'electricity',
    rows: [
      {
        name: '電気 東京電力エナジーパートナー(株) メニューL(残差)',
        energyType: 'electricity',
        unit: 't-CO2/kWh',
        factorValue: 0.000452,
        providerName: '東京電力エナジーパートナー(株)',
        providerNumber: 'A0269',
        menuName: 'メニューL(残差)',
      },
    ],
    registrationNumber: 'A0269',
    supplierName: null,
  }),
};

const fuelTarget: MatchingTarget = {
  index: 2,
  item: { ...electricityTarget.item, kind: 'fuel', planName: null, fuelName: 'レギュラーガソリン', unit: 'L' },
  candidates: buildFuelCandidates([
    {
      name: '燃料 揮発油',
      energyType: 'fuel_gasoline',
      unit: 'tCO2/kL',
      factorValue: 2.29,
      providerName: null,
      providerNumber: null,
      menuName: null,
    },
  ]),
};

const targets = [electricityTarget, fuelTarget];

describe('FACTOR_MATCHING_SCHEMA', () => {
  it('3 社で使える書き方になっている', () => {
    expect(findPortableSchemaProblems(FACTOR_MATCHING_SCHEMA)).toEqual([]);
  });
});

describe('buildMatchingInput', () => {
  it('明細ごとに読み取った値と、その明細の候補を並べる', () => {
    const text = buildMatchingInput(extraction, targets);
    expect(text).toContain('明細 1\n  種類: 電気');
    expect(text).toContain('  登録番号: A0269');
    expect(text).toContain('  料金メニュー: スタンダードS');
    expect(text).toContain('  候補（電気の事業者別係数）:\n  p1: 東京電力エナジーパートナー(株)（登録番号 A0269）');
    expect(text).toContain('明細 2\n  種類: 燃料');
    expect(text).toContain('  燃料の名称: レギュラーガソリン');
    expect(text).toContain('  f1: [ガソリン] 燃料 揮発油（2.29 tCO2/kL）');
  });
});

describe('validateFactorMatching', () => {
  const validate = validateFactorMatching(targets);

  it('その明細の候補にある key と null だけを答えとして採る', () => {
    const answers = validate({
      items: [
        { index: 1, key: 'p1-m1', reason: '登録番号が一致し、残差を選んだ' },
        { index: 2, key: null, reason: '分からない' },
      ],
    });
    expect(answers?.get(1)).toEqual({ answered: true, key: 'p1-m1', reason: '登録番号が一致し、残差を選んだ' });
    expect(answers?.get(2)).toEqual({ answered: true, key: null, reason: '分からない' });
  });

  it('別の明細の key・候補に無い key・答えの無い明細は「答えなし」にする（AI が作った値で係数を決めない）', () => {
    const answers = validate({ items: [{ index: 1, key: 'f1', reason: 'x' }, { index: 9, key: 'p1', reason: 'x' }] });
    expect(answers?.get(1)).toEqual({ answered: false });
    expect(answers?.get(2)).toEqual({ answered: false });
    expect(answers?.has(9)).toBe(false);
  });

  it('同じ明細に答えが 2 つあれば、最初の答えを採る', () => {
    const answers = validate({ items: [{ index: 2, key: 'f1', reason: '1 つ目' }, { index: 2, key: null, reason: '2 つ目' }] });
    expect(answers?.get(2)).toEqual({ answered: true, key: 'f1', reason: '1 つ目' });
  });

  it('いちばん外側の形が違えば null（bad_response）', () => {
    expect(validate(null)).toBeNull();
    expect(validate({ items: 'x' })).toBeNull();
  });

  it('理由は空白をそろえ、長すぎれば切る', () => {
    const answers = validate({ items: [{ index: 2, key: 'f1', reason: ` ${'あ'.repeat(200)}\n` }] });
    const answer = answers?.get(2);
    expect(answer?.answered && answer.reason).toHaveLength(120);
  });
});
