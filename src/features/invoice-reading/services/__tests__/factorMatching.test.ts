import { describe, expect, it } from 'vitest';
import { findPortableSchemaProblems } from '@/lib/ai/schema';
import type { InvoiceExtraction } from '../../types';
import { buildFuelCandidates, buildProviderCandidates } from '../factorCandidates';
import {
  FACTOR_MATCHING_INSTRUCTIONS,
  FACTOR_MATCHING_SCHEMA,
  buildMatchingInput,
  replaceCandidateKeys,
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

  it('理由に残った候補のキーは、その明細の候補の名前に置き換える（画面の外の値を出さない）', () => {
    const answers = validate({
      items: [
        { index: 1, key: 'p1-m1', reason: '登録番号が一致したため p1-m1 を選択。' },
        { index: 2, key: 'f1', reason: 'レギュラーガソリンは揮発油に該当するため、候補の中からf1を選択。' },
      ],
    });
    expect(answers?.get(1)).toMatchObject({ reason: '登録番号が一致したため 東京電力エナジーパートナー(株)の「メニューL(残差)」 を選択。' });
    expect(answers?.get(2)).toMatchObject({ reason: 'レギュラーガソリンは揮発油に該当するため、候補の中から燃料 揮発油を選択。' });
  });

  it('理由は空白をそろえ、長すぎれば切る', () => {
    const answers = validate({ items: [{ index: 2, key: 'f1', reason: ` ${'あ'.repeat(200)}\n` }] });
    const answer = answers?.get(2);
    expect(answer?.answered && answer.reason).toHaveLength(120);
  });

  it('長さは AI が書いた文で切り、キーを名前にしたことで文の終わりが切れないようにする', () => {
    const reason = `${'あ'.repeat(100)} p1-m1 を選択。`;
    const answers = validate({ items: [{ index: 1, key: 'p1-m1', reason }] });
    expect(answers?.get(1)).toMatchObject({ reason: `${'あ'.repeat(100)} 東京電力エナジーパートナー(株)の「メニューL(残差)」 を選択。` });
  });
});

describe('replaceCandidateKeys', () => {
  const labels = new Map([
    ['p1', '東京ガス(株)'],
    ['p1-m2', '東京ガス(株)の「メニューB」'],
    ['f1', '燃料 揮発油'],
  ]);

  it('メニューのキー（p1-m2）は、事業者のキー（p1）とメニューの名前に分けずに置き換える', () => {
    expect(replaceCandidateKeys('p1-m2 を選んだ', labels)).toBe('東京ガス(株)の「メニューB」 を選んだ');
  });

  it('大文字・全角のキーや、ハイフンでつないだキーも置き換える', () => {
    expect(replaceCandidateKeys('P1・ｆ１・Ｐ１－Ｍ２・残差-p1', labels)).toBe(
      '東京ガス(株)・燃料 揮発油・東京ガス(株)の「メニューB」・残差-東京ガス(株)',
    );
  });

  it('名前に括弧で添えたキーは、名前が二重にならないよう括弧ごと消す', () => {
    expect(replaceCandidateKeys('揮発油（f1）を選択', labels)).toBe('揮発油を選択');
    expect(replaceCandidateKeys('東京ガス(株) (p1) を選んだ', labels)).toBe('東京ガス(株) を選んだ');
    expect(replaceCandidateKeys('（p1 のメニュー）', labels)).toBe('（東京ガス(株) のメニュー）');
  });

  it('候補に無いキーや、英数字の途中にある文字はそのまま', () => {
    expect(replaceCandidateKeys('f2 と f10、cf1・A0269・（p9） はそのまま', labels)).toBe(
      'f2 と f10、cf1・A0269・（p9） はそのまま',
    );
  });
});

describe('FACTOR_MATCHING_INSTRUCTIONS', () => {
  it('理由は画面に出るので、キーや key・null の言葉を書かないよう伝える', () => {
    const rule = FACTOR_MATCHING_INSTRUCTIONS.split('\n').find((line) => line.startsWith('reason'));
    expect(rule).toMatch(/p1/);
    expect(rule).toMatch(/null/);
    expect(rule).toMatch(/書かず/);
  });
});
