import { describe, expect, it } from 'vitest';
import {
  MAX_PROVIDERS_WITH_MENUS,
  buildFuelCandidates,
  buildProviderCandidates,
  candidateLabelsOf,
  comparableProviderName,
  formatCandidateLines,
  resolveFallbackMenu,
  type CandidateSourceRow,
} from '../factorCandidates';

const providerRow = (overrides: Partial<CandidateSourceRow> = {}): CandidateSourceRow => ({
  name: '電気 東京電力エナジーパートナー(株) メニューL(残差)（調整後）',
  energyType: 'electricity',
  unit: 't-CO2/kWh',
  factorValue: 0.000452,
  providerName: '東京電力エナジーパートナー(株)',
  providerNumber: 'A0269',
  menuName: 'メニューL(残差)',
  ...overrides,
});

// 東京電力エナジーパートナー（メニュー A・L(残差)・参考値。基礎・調整後の 2 行ずつ）と、別の事業者 1 社
const rows: CandidateSourceRow[] = [
  providerRow({ menuName: 'メニューA' }),
  providerRow({ menuName: 'メニューA' }),
  providerRow({ menuName: 'メニューL(残差)' }),
  providerRow({ menuName: 'メニューL(残差)' }),
  providerRow({ menuName: '(参考値)事業者全体' }),
  providerRow({ providerName: 'エバーグリーン・リテイリング(株)', providerNumber: 'A0004', menuName: 'メニューA' }),
  // 都市ガスの行は電気の候補に混ざらない
  providerRow({ energyType: 'city_gas', providerName: '東京ガス(株)', providerNumber: 'A0001', menuName: '残差' }),
];

describe('comparableProviderName', () => {
  it('「株式会社」と「(株)」、全角・空白の違いを無視する', () => {
    expect(comparableProviderName('東京電力エナジーパートナー株式会社')).toBe(
      comparableProviderName('東京電力エナジーパートナー（株）'),
    );
    expect(comparableProviderName('ＡＢＣ でんき 株式会社')).toBe('abcでんき');
  });
});

describe('buildProviderCandidates', () => {
  it('登録番号が一致する事業者に絞り、基礎・調整後をまとめ、参考値のメニューは外す', () => {
    const set = buildProviderCandidates({
      energyType: 'electricity',
      rows,
      registrationNumber: 'A0269',
      supplierName: null,
    });
    expect(set.narrowedBy).toBe('registration_number');
    expect(set.includeMenus).toBe(true);
    expect(set.providers).toEqual([
      {
        key: 'p1',
        providerName: '東京電力エナジーパートナー(株)',
        providerNumbers: ['A0269'],
        menus: [
          { key: 'p1-m1', menuName: 'メニューA' },
          { key: 'p1-m2', menuName: 'メニューL(残差)' },
        ],
      },
    ]);
  });

  it('登録番号が読めなければ、事業者名（会社の種類の書き方の違いを無視）で絞る', () => {
    const set = buildProviderCandidates({
      energyType: 'electricity',
      rows,
      registrationNumber: null,
      supplierName: '東京電力エナジーパートナー株式会社',
    });
    expect(set.narrowedBy).toBe('name');
    expect(set.providers.map((provider) => provider.providerName)).toEqual(['東京電力エナジーパートナー(株)']);
  });

  it('番号の行が無い・名前も一致しなければ、すべての事業者を候補にする', () => {
    const set = buildProviderCandidates({
      energyType: 'electricity',
      rows,
      registrationNumber: 'A9999',
      supplierName: '架空でんき',
    });
    expect(set.narrowedBy).toBeNull();
    expect(set.providers).toHaveLength(2);
  });

  it('事業者が多いときはメニューを AI に見せない（電気の全事業者）', () => {
    const many = Array.from({ length: MAX_PROVIDERS_WITH_MENUS + 1 }, (_, index) =>
      providerRow({ providerName: `事業者${index}`, providerNumber: `A${String(index).padStart(4, '0')}` }),
    );
    const set = buildProviderCandidates({ energyType: 'electricity', rows: many, registrationNumber: null, supplierName: null });
    expect(set.includeMenus).toBe(false);
    expect(formatCandidateLines(set)[0]).toBe('p1: 事業者0（登録番号 A0000）');
    expect(candidateLabelsOf(set).has('p1-m1')).toBe(false);
  });

  it('AI に見せる文は、事業者の行の下にメニューの行を並べる', () => {
    const set = buildProviderCandidates({ energyType: 'electricity', rows, registrationNumber: 'A0269', supplierName: null });
    expect(formatCandidateLines(set)).toEqual([
      'p1: 東京電力エナジーパートナー(株)（登録番号 A0269）',
      '  p1-m1: メニュー「メニューA」',
      '  p1-m2: メニュー「メニューL(残差)」',
    ]);
    expect(candidateLabelsOf(set)).toEqual(
      new Map([
        ['p1', '東京電力エナジーパートナー(株)'],
        ['p1-m1', '東京電力エナジーパートナー(株)の「メニューA」'],
        ['p1-m2', '東京電力エナジーパートナー(株)の「メニューL(残差)」'],
      ]),
    );
  });
});

describe('resolveFallbackMenu', () => {
  it('公表メニューが 1 つだけならそれ、複数なら決めない（人が選ぶ）', () => {
    const set = buildProviderCandidates({ energyType: 'electricity', rows, registrationNumber: null, supplierName: null });
    const [tepco, evergreen] = set.providers;
    expect(resolveFallbackMenu(evergreen)).toBe('メニューA');
    expect(resolveFallbackMenu(tepco)).toBeNull();
  });
});

describe('buildFuelCandidates', () => {
  it('主要燃料 5 種の標準係数だけを、種別と名前で 1 つにまとめて並べる', () => {
    const fuel = (energyType: string, name: string, unit = 'tCO2/kL', factorValue = 2.5): CandidateSourceRow => ({
      name,
      energyType,
      unit,
      factorValue,
      providerName: null,
      providerNumber: null,
      menuName: null,
    });
    const set = buildFuelCandidates([
      fuel('fuel_gasoline', '燃料 揮発油', 'tCO2/kL', 2.29),
      fuel('fuel_gasoline', '燃料 揮発油', 'tCO2/kL', 2.29),
      fuel('fuel_heavy_oil', '燃料 A重油', 'tCO2/kL', 2.75),
      fuel('fuel_heavy_oil', '燃料 B・C重油', 'tCO2/kL', 3.1),
      fuel('fuel_jet', '燃料 ジェット燃料油'),
      fuel('fuel', '燃料 コールタール', 'tCO2/t'),
    ]);
    expect(set.fuels.map((candidate) => [candidate.key, candidate.factorName])).toEqual([
      ['f1', '燃料 揮発油'],
      ['f2', '燃料 A重油'],
      ['f3', '燃料 B・C重油'],
    ]);
    expect(formatCandidateLines(set)[0]).toBe('f1: [ガソリン] 燃料 揮発油（2.29 tCO2/kL）');
  });
});
