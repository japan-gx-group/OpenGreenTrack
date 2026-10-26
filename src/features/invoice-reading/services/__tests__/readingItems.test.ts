import { describe, expect, it } from 'vitest';
import type { InvoiceExtractedItem, InvoiceExtraction } from '../../types';
import { buildFuelCandidates, buildProviderCandidates, type CandidateSourceRow } from '../factorCandidates';
import type { MatchingAnswer } from '../factorMatching';
import {
  buildReadingItem,
  convertToEntryUnit,
  guessFuelEnergyType,
  normalizeInvoiceUnit,
  targetMonthOf,
  type ItemContext,
} from '../readingItems';

const electricityItem: InvoiceExtractedItem = {
  kind: 'electricity',
  planName: 'スタンダードS',
  fuelName: null,
  usageMonth: '2025-09',
  periodStart: '2025-08-05',
  periodEnd: '2025-09-03',
  amount: 12345,
  unit: 'kWh',
};

const extraction: InvoiceExtraction = {
  kind: 'electricity',
  supplierName: '東京電力エナジーパートナー株式会社',
  supplierRegistrationNumber: 'A0269',
  supplyAddress: '東京都架空区架空町1-1-1',
  items: [electricityItem],
  warnings: [],
};

const providerRow = (providerName: string, menuName: string, providerNumber = 'A0269'): CandidateSourceRow => ({
  name: `電気 ${providerName} ${menuName}`,
  energyType: 'electricity',
  unit: 't-CO2/kWh',
  factorValue: 0.000452,
  providerName,
  providerNumber,
  menuName,
});

const providerCandidates = (menus: string[]) =>
  buildProviderCandidates({
    energyType: 'electricity',
    rows: menus.map((menu) => providerRow('東京電力エナジーパートナー(株)', menu)),
    registrationNumber: 'A0269',
    supplierName: null,
  });

const answered = (key: string | null, reason = '理由'): MatchingAnswer => ({ answered: true, key, reason });

const build = (context: Partial<ItemContext>, location: { id: string; name: string } | null = { id: 'tokyo', name: '東京本社' }) =>
  buildReadingItem({
    extraction,
    context: { index: 1, item: electricityItem, candidates: null, answer: undefined, matchingError: null, ...context },
    location,
    fileName: '9月分.pdf',
  });

describe('normalizeInvoiceUnit / convertToEntryUnit', () => {
  it('請求書の単位の書き方をそろえ、フォームの単位に換算する', () => {
    expect(normalizeInvoiceUnit('ｋＷｈ')).toBe('kWh');
    expect(normalizeInvoiceUnit('㎥')).toBe('m3');
    expect(normalizeInvoiceUnit('リットル')).toBe('L');
    expect(convertToEntryUnit(1.5, 'MWh', 'electricity')).toEqual({ value: 1500, unit: 'kWh' });
    expect(convertToEntryUnit(2, 'kl', 'fuel_diesel')).toEqual({ value: 2000, unit: 'L' });
    expect(convertToEntryUnit(500, 'kg', 'fuel_lpg')).toEqual({ value: 0.5, unit: 't' });
    expect(convertToEntryUnit(1234, '㎥', 'city_gas')).toEqual({ value: 1234, unit: 'm³' });
  });

  it('次元の違う単位は換算しない（推測で単位を決めない）', () => {
    expect(convertToEntryUnit(10, 'm3', 'fuel_lpg')).toBeNull();
    expect(convertToEntryUnit(10, '円', 'electricity')).toBeNull();
  });
});

describe('guessFuelEnergyType / targetMonthOf', () => {
  it('燃料の名称からカテゴリだけを決める', () => {
    expect(guessFuelEnergyType('レギュラーガソリン')).toBe('fuel_gasoline');
    expect(guessFuelEnergyType('プロパンガス')).toBe('fuel_lpg');
    expect(guessFuelEnergyType('A重油')).toBe('fuel_heavy_oil');
    expect(guessFuelEnergyType('水道')).toBeNull();
  });

  it('対象年月は「◯月分」、無ければ使用期間の終わりの月', () => {
    expect(targetMonthOf(electricityItem)).toBe('2025-09');
    expect(targetMonthOf({ ...electricityItem, usageMonth: null })).toBe('2025-09');
    expect(targetMonthOf({ ...electricityItem, usageMonth: null, periodEnd: null })).toBeNull();
  });
});

describe('buildReadingItem（電気・都市ガス）', () => {
  it('事業者とメニューが当てはまれば、フォームに事業者・メニュー・活動量・拠点・対象年月・備考を入れる', () => {
    const item = build({ candidates: providerCandidates(['メニューA', 'メニューL(残差)']), answer: answered('p1-m2', '残差を選んだ') });
    expect(item.factor).toEqual({
      status: 'matched',
      label: '東京電力エナジーパートナー(株) / メニューL(残差)',
      reason: '残差を選んだ',
    });
    expect(item.title).toBe('電気 2025年9月分');
    expect(item.notices).toEqual([]);
    expect(item.prefill).toEqual({
      locationId: 'tokyo',
      supplyAddress: '東京都架空区架空町1-1-1',
      energyType: 'electricity',
      targetMonth: '2025-09',
      amount: '12345',
      note: '請求書から読取り 東京電力エナジーパートナー株式会社 スタンダードS 2025年9月分',
      factor: { kind: 'provider', providerName: '東京電力エナジーパートナー(株)', menuName: 'メニューL(残差)' },
      sourceLabel: '請求書「9月分.pdf」から読み取った値を入れました。',
    });
  });

  it('AI が事業者だけを選んだとき、公表メニューが 1 つならそのメニューを使う', () => {
    const item = build({ candidates: providerCandidates(['メニューA']), answer: answered('p1') });
    expect(item.factor.status).toBe('matched');
    expect(item.prefill?.factor).toEqual({ kind: 'provider', providerName: '東京電力エナジーパートナー(株)', menuName: 'メニューA' });
  });

  it('公表メニューが複数で事業者だけが分かれば、メニューは人が選ぶ', () => {
    const item = build({ candidates: providerCandidates(['メニューA', 'メニューB(残差)']), answer: answered('p1') });
    expect(item.factor).toMatchObject({ status: 'provider_only', label: '東京電力エナジーパートナー(株)' });
    expect(item.prefill?.factor).toEqual({ kind: 'provider', providerName: '東京電力エナジーパートナー(株)', menuName: null });
  });

  it('電気で「残差」のメニューが複数あれば、AI が 1 つを選んでも採らず、人に選んでもらう', () => {
    const item = build({
      candidates: providerCandidates(['メニューA', 'メニューL(残差)', 'メニューM(残差)']),
      answer: answered('p1-m2'),
    });
    expect(item.factor.status).toBe('provider_only');
    expect(item.prefill?.factor).toMatchObject({ menuName: null });
    expect(item.notices[0]).toContain('「残差」のメニューが複数あります（メニューL(残差)・メニューM(残差)）');
  });

  it('当てはまる係数が無ければ、事業者は選ばずに入れる（代替値で算定される）', () => {
    const item = build({ candidates: providerCandidates(['メニューA']), answer: answered(null, '登録番号の事業者がいない') });
    expect(item.factor).toEqual({ status: 'not_found', reason: '登録番号の事業者がいない' });
    expect(item.prefill).toMatchObject({ energyType: 'electricity', factor: null, amount: '12345' });
  });

  it('判定の AI が失敗したら理由を出し、読み取った使用量だけを入れる', () => {
    const item = build({
      candidates: providerCandidates(['メニューA']),
      answer: undefined,
      matchingError: '排出係数を判定できませんでした（時間内に応答がありませんでした）。フォームで選んでください',
    });
    expect(item.factor.status).toBe('unavailable');
    expect(item.factor.reason).toContain('時間内に応答がありませんでした');
    expect(item.prefill).toMatchObject({ energyType: 'electricity', factor: null });
  });

  it('拠点・使用月・単位が分からなければ、フォームで確かめることを案内する', () => {
    const item = build(
      {
        item: { ...electricityItem, usageMonth: null, periodEnd: null, unit: null },
        candidates: providerCandidates(['メニューA']),
        answer: answered('p1-m1'),
      },
      null,
    );
    expect(item.notices).toEqual([
      '使用量の単位を読み取れませんでした。単位を確かめて活動量を入力してください',
      '使用月を読み取れませんでした。対象年月を選んでください',
      '需要場所の住所から拠点を決められませんでした。拠点を選んでください',
    ]);
    expect(item.prefill).toMatchObject({ locationId: '', targetMonth: null, amount: '' });
  });
});

describe('buildReadingItem（燃料・対象外）', () => {
  const fuelItem: InvoiceExtractedItem = { ...electricityItem, kind: 'fuel', planName: null, fuelName: '軽油', amount: 180, unit: 'L' };
  const fuels = buildFuelCandidates(
    [
      ['fuel_gasoline', '燃料 揮発油'],
      ['fuel_diesel', '燃料 軽油'],
    ].map(([energyType, name]) => ({
      name,
      energyType,
      unit: 'tCO2/kL',
      factorValue: 2.5,
      providerName: null,
      providerNumber: null,
      menuName: null,
    })),
  );

  it('燃料が当てはまれば、その燃料のカテゴリと係数の名前を入れる', () => {
    const item = build({ item: fuelItem, candidates: fuels, answer: answered('f2') });
    expect(item.energyType).toBe('fuel_diesel');
    expect(item.title).toBe('軽油 2025年9月分');
    expect(item.prefill).toMatchObject({ energyType: 'fuel_diesel', amount: '180', factor: { kind: 'standard', factorName: '燃料 軽油' } });
  });

  it('燃料の係数が決まらなくても、名称からカテゴリが分かればカテゴリだけを入れる', () => {
    const item = build({ item: { ...fuelItem, fuelName: 'A重油' }, candidates: fuels, answer: answered(null) });
    expect(item.energyType).toBe('fuel_heavy_oil');
    expect(item.prefill).toMatchObject({ energyType: 'fuel_heavy_oil', factor: null });
  });

  it('燃料の種類も分からなければ、フォームには入れない', () => {
    const item = build({ item: { ...fuelItem, fuelName: '混合燃料' }, candidates: fuels, answer: answered(null) });
    expect(item.prefill).toBeNull();
    expect(item.notices).toContain('燃料の種類を決められませんでした。フォームでカテゴリを選んでください');
  });

  it('対象外の明細は、読み取った内容だけを見せてフォームには入れない', () => {
    const item = build({ item: { ...electricityItem, kind: 'other' } });
    expect(item.prefill).toBeNull();
    expect(item.factor.status).toBe('unavailable');
  });
});
