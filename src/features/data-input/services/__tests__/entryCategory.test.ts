import { describe, expect, it } from 'vitest';
import { ENERGY_TYPES } from '@/features/calculation/types';
import { SCOPE3_CATEGORY_IDS } from '@/features/scope-analysis/services/scopeAnalysisService';
import { MANUAL_ACTIVITY_CATEGORIES, MANUAL_ACTIVITY_CATEGORY_MAP } from '../../types';
import type { SavedManualActivityRecord } from '../../types';
import {
  DEFAULT_ENTRY_CATEGORY,
  buildEntryCategoryGroups,
  entryCategoryFromInitialValues,
  entryCategoryLabel,
  entryPathOf,
  factorSourceOf,
  formatEntryCategoryValue,
  isSameEntryCategory,
  parseEntryCategoryValue,
  resolveEntryUnit,
  scope3CategoryLabel,
  toActivityEntryInitialValues,
  type EntryCategory,
} from '../entryCategory';

// 統合データ入力フォームのカテゴリ判定（純関数）のテスト。
// 選択肢の組み立てが MANUAL_ACTIVITY_CATEGORIES と過不足なく一致すること、
// 参照方式・保存経路・単位の決定順が仕様どおりであることを固定する。

describe('formatEntryCategoryValue / parseEntryCategoryValue', () => {
  it('EnergyType 全種（scope3_activity を除く）と Scope3 カテゴリ 1〜15 で往復できる', () => {
    for (const energyType of ENERGY_TYPES.filter((type) => type !== 'scope3_activity')) {
      const category: EntryCategory = { kind: 'energy', energyType };
      expect(parseEntryCategoryValue(formatEntryCategoryValue(category))).toEqual(category);
    }
    for (const categoryId of SCOPE3_CATEGORY_IDS) {
      const category: EntryCategory = { kind: 'scope3', categoryId };
      expect(parseEntryCategoryValue(formatEntryCategoryValue(category))).toEqual(category);
    }
  });

  it('不正な値は null になる', () => {
    expect(parseEntryCategoryValue('energy:unknown')).toBeNull();
    // scope3_activity は EnergyType だが Scope1/2 経路の値としては不正
    expect(parseEntryCategoryValue('energy:scope3_activity')).toBeNull();
    expect(parseEntryCategoryValue('scope3:0')).toBeNull();
    expect(parseEntryCategoryValue('scope3:16')).toBeNull();
    expect(parseEntryCategoryValue('scope3:1.5')).toBeNull();
    expect(parseEntryCategoryValue('scope3:')).toBeNull();
    expect(parseEntryCategoryValue('electricity')).toBeNull();
    expect(parseEntryCategoryValue('')).toBeNull();
  });
});

describe('factorSourceOf / entryPathOf', () => {
  it('電気・都市ガス・熱は供給事業者別係数、それ以外の Scope1/2 は標準係数、Scope3 は IDEA', () => {
    expect(factorSourceOf({ kind: 'energy', energyType: 'electricity' })).toBe('provider');
    expect(factorSourceOf({ kind: 'energy', energyType: 'city_gas' })).toBe('provider');
    expect(factorSourceOf({ kind: 'energy', energyType: 'heat' })).toBe('provider');
    expect(factorSourceOf({ kind: 'energy', energyType: 'fuel' })).toBe('standard');
    expect(factorSourceOf({ kind: 'energy', energyType: 'waste' })).toBe('standard');
    expect(factorSourceOf({ kind: 'energy', energyType: 'fuel_diesel' })).toBe('standard');
    expect(factorSourceOf({ kind: 'scope3', categoryId: 1 })).toBe('idea');
  });

  it('保存経路は Scope3 積上げだけが scope3', () => {
    expect(entryPathOf({ kind: 'energy', energyType: 'electricity' })).toBe('scope12');
    expect(entryPathOf({ kind: 'energy', energyType: 'waste' })).toBe('scope12');
    expect(entryPathOf({ kind: 'scope3', categoryId: 15 })).toBe('scope3');
  });

  it('既定カテゴリは電気', () => {
    expect(DEFAULT_ENTRY_CATEGORY).toEqual({ kind: 'energy', energyType: 'electricity' });
  });
});

describe('ラベル', () => {
  it('energy は labelJP、scope3 は「カテゴリN: 名称」', () => {
    expect(entryCategoryLabel({ kind: 'energy', energyType: 'electricity' })).toBe('電気');
    expect(entryCategoryLabel({ kind: 'scope3', categoryId: 1 })).toBe('カテゴリ1: 購入した製品・サービス');
    expect(scope3CategoryLabel(15)).toBe('カテゴリ15: 投資');
  });

  it('isSameEntryCategory は kind と中身の両方で比較する', () => {
    expect(
      isSameEntryCategory({ kind: 'energy', energyType: 'fuel' }, { kind: 'energy', energyType: 'fuel' }),
    ).toBe(true);
    expect(
      isSameEntryCategory({ kind: 'energy', energyType: 'fuel' }, { kind: 'energy', energyType: 'waste' }),
    ).toBe(false);
    expect(isSameEntryCategory({ kind: 'scope3', categoryId: 1 }, { kind: 'scope3', categoryId: 1 })).toBe(true);
    expect(isSameEntryCategory({ kind: 'scope3', categoryId: 1 }, { kind: 'energy', energyType: 'fuel' })).toBe(false);
  });
});

describe('buildEntryCategoryGroups', () => {
  const energyOptionsOf = (groups: ReturnType<typeof buildEntryCategoryGroups>) =>
    groups
      .filter((group) => group.path === 'scope12')
      .flatMap((group) => group.options)
      .map((option) => option.category)
      .filter((category): category is Extract<EntryCategory, { kind: 'energy' }> => category.kind === 'energy')
      .map((category) => category.energyType);

  it('新規入力: 手動カテゴリ 7 件が参照方式の 2 群に過不足なく現れ、Scope3 の 15 件が 3 群目に並ぶ', () => {
    const groups = buildEntryCategoryGroups({ mode: 'create', initialCategory: null });

    expect(groups.map((group) => group.id)).toEqual(['provider', 'standard', 'idea']);
    expect(groups.every((group) => group.disabled === false)).toBe(true);
    // 順序は問わず集合として一致（群内の並びは定数の順序を保つ）
    expect([...energyOptionsOf(groups)].sort()).toEqual([...MANUAL_ACTIVITY_CATEGORIES].sort());
    expect(groups[0].options.map((option) => option.category)).toEqual([
      { kind: 'energy', energyType: 'electricity' },
      { kind: 'energy', energyType: 'city_gas' },
      { kind: 'energy', energyType: 'heat' },
    ]);
    expect(groups[1].options.map((option) => option.label)).toEqual(
      MANUAL_ACTIVITY_CATEGORIES.filter((c) => !['electricity', 'city_gas', 'heat'].includes(c)).map(
        (c) => MANUAL_ACTIVITY_CATEGORY_MAP[c].labelJP,
      ),
    );
    expect(groups[2].options).toHaveLength(15);
    expect(groups[2].options[0]).toEqual({
      value: 'scope3:1',
      label: 'カテゴリ1: 購入した製品・サービス',
      category: { kind: 'scope3', categoryId: 1 },
    });
  });

  it('option の label は labelJP そのもの（E2E の selectOption({ label: "電気" }) と一致する）', () => {
    const groups = buildEntryCategoryGroups({ mode: 'create', initialCategory: null });
    const electricity = groups[0].options.find((option) => option.value === 'energy:electricity');
    expect(electricity?.label).toBe('電気');
  });

  it('編集（Scope1/2）: 取込レコードの種別を標準係数群の先頭に足し、IDEA 群を disabled にする', () => {
    const groups = buildEntryCategoryGroups({
      mode: 'edit',
      initialCategory: { kind: 'energy', energyType: 'fuel_diesel' },
    });
    expect(groups[1].options[0]).toEqual({
      value: 'energy:fuel_diesel',
      label: '軽油',
      category: { kind: 'energy', energyType: 'fuel_diesel' },
    });
    expect(energyOptionsOf(groups)).toHaveLength(MANUAL_ACTIVITY_CATEGORIES.length + 1);
    expect(groups.map((group) => group.disabled)).toEqual([false, false, true]);
  });

  it('編集（Scope1/2・手動カテゴリ）: 先頭追加は無く、IDEA 群だけ disabled', () => {
    const groups = buildEntryCategoryGroups({
      mode: 'edit',
      initialCategory: { kind: 'energy', energyType: 'electricity' },
    });
    expect(energyOptionsOf(groups)).toHaveLength(MANUAL_ACTIVITY_CATEGORIES.length);
    expect(groups.map((group) => group.disabled)).toEqual([false, false, true]);
  });

  it('編集（Scope3）: Scope1/2 の 2 群が disabled', () => {
    const groups = buildEntryCategoryGroups({
      mode: 'edit',
      initialCategory: { kind: 'scope3', categoryId: 4 },
    });
    expect(groups.map((group) => group.disabled)).toEqual([true, true, false]);
    expect(energyOptionsOf(groups)).toHaveLength(MANUAL_ACTIVITY_CATEGORIES.length);
  });
});

describe('entryCategoryFromInitialValues', () => {
  it('初期値の kind に応じてカテゴリを組み立てる', () => {
    expect(entryCategoryFromInitialValues(undefined)).toBeNull();
    expect(
      entryCategoryFromInitialValues({
        kind: 'scope12',
        locationId: 'loc',
        locationName: '本社',
        energyType: 'city_gas',
        unit: 'm3',
        targetMonth: '2024-11',
        amount: '10',
        note: '',
        emissionFactorId: null,
      }),
    ).toEqual({ kind: 'energy', energyType: 'city_gas' });
    expect(
      entryCategoryFromInitialValues({
        kind: 'scope3',
        locationId: 'loc',
        locationName: '本社',
        scope3CategoryId: 7,
        ideaFactorId: null,
        targetMonth: '2024-11',
        amount: '10',
        note: '',
      }),
    ).toEqual({ kind: 'scope3', categoryId: 7 });
  });
});

describe('toActivityEntryInitialValues', () => {
  const record: SavedManualActivityRecord = {
    id: 'rec-1',
    locationId: 'loc-1',
    locationName: '大阪支社',
    energyType: 'electricity',
    amount: 245.78,
    unit: 'MWh',
    periodStart: '2024-11-01',
    periodEnd: '2024-11-30',
    note: null,
    createdAt: '2024-12-01T00:00:00Z',
    emissionFactorId: 'fac-1',
    emissions: null,
    scope3CategoryId: null,
    ideaFactorId: null,
    ideaProductName: null,
  };

  it('Scope1/2 行は記録の unit と係数 id をそのまま渡し、note は空文字にする', () => {
    expect(toActivityEntryInitialValues(record)).toEqual({
      kind: 'scope12',
      locationId: 'loc-1',
      locationName: '大阪支社',
      energyType: 'electricity',
      unit: 'MWh',
      targetMonth: '2024-11',
      amount: '245.78',
      note: '',
      emissionFactorId: 'fac-1',
    });
  });

  it('Scope3 行はカテゴリ（null なら 1）と ideaFactorId（孤児は null のまま）を渡す', () => {
    expect(
      toActivityEntryInitialValues({
        ...record,
        energyType: 'scope3_activity',
        unit: 'kg',
        note: 'メモ',
        emissionFactorId: null,
        scope3CategoryId: null,
        ideaFactorId: null,
      }),
    ).toEqual({
      kind: 'scope3',
      locationId: 'loc-1',
      locationName: '大阪支社',
      scope3CategoryId: 1,
      ideaFactorId: null,
      targetMonth: '2024-11',
      amount: '245.78',
      note: 'メモ',
    });
    expect(
      toActivityEntryInitialValues({
        ...record,
        energyType: 'scope3_activity',
        scope3CategoryId: 4,
        ideaFactorId: 'idea-1',
      }),
    ).toMatchObject({ kind: 'scope3', scope3CategoryId: 4, ideaFactorId: 'idea-1' });
  });
});

describe('resolveEntryUnit', () => {
  it('新規入力はカテゴリの標準単位', () => {
    expect(
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'electricity' },
        mode: 'create',
        initial: null,
        productUnit: null,
      }),
    ).toEqual({ kind: 'energy', unit: 'kWh', standardUnit: 'kWh', isNonStandard: false, isFactorDerived: false });
  });

  it('編集でカテゴリが初期値と同じ間は記録の単位を保持し、標準単位と異なれば非標準と判定する', () => {
    const initial = { energyType: 'electricity' as const, unit: 'MWh' };
    expect(
      resolveEntryUnit({ category: { kind: 'energy', energyType: 'electricity' }, mode: 'edit', initial, productUnit: null }),
    ).toEqual({ kind: 'energy', unit: 'MWh', standardUnit: 'kWh', isNonStandard: true, isFactorDerived: false });
    // 表記ゆれ（m3 と m³）は算定上同一なので非標準扱いにしない
    expect(
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'city_gas' },
        mode: 'edit',
        initial: { energyType: 'city_gas', unit: 'm3' },
        productUnit: null,
      }),
    ).toEqual({ kind: 'energy', unit: 'm3', standardUnit: 'm³', isNonStandard: false, isFactorDerived: false });
    // 記録の単位が標準単位と同じなら非標準ではない
    expect(
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'electricity' },
        mode: 'edit',
        initial: { energyType: 'electricity', unit: 'kWh' },
        productUnit: null,
      }),
    ).toEqual({ kind: 'energy', unit: 'kWh', standardUnit: 'kWh', isNonStandard: false, isFactorDerived: false });
  });

  it('編集でカテゴリを変えると標準単位になる', () => {
    expect(
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'city_gas' },
        mode: 'edit',
        initial: { energyType: 'electricity', unit: 'MWh' },
        productUnit: null,
      }),
    ).toEqual({ kind: 'energy', unit: 'm³', standardUnit: 'm³', isNonStandard: false, isFactorDerived: false });
  });

  it('出張は公式係数の分母（円 / 泊 / 人・年）に応じて入力単位を切り替える', () => {
    const create = (factorUnit: string) =>
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'business_travel' },
        mode: 'create',
        initial: null,
        productUnit: null,
        factorUnit,
      });
    // 延べ出張日数当たり（t-CO2/人・日）は標準単位のまま
    expect(create('t-CO2/人・日')).toEqual({
      kind: 'energy', unit: '人・日', standardUnit: '人・日', isNonStandard: false, isFactorDerived: false,
    });
    expect(create('kg-CO2/円').unit).toBe('円');
    expect(create('kg-CO2/泊').unit).toBe('泊');
    expect(create('t-CO2/人・年').unit).toBe('人・年');
    expect(create('kg-CO2/円')).toMatchObject({ standardUnit: '人・日', isFactorDerived: true });
  });

  it('標準単位が適用係数の単位へ換算できなければ係数の分母単位を採る（通勤にカスタム係数 t-CO2e/km → km）', () => {
    expect(
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'business_travel_commuting' },
        mode: 'create',
        initial: null,
        productUnit: null,
        factorUnit: 't-CO2e/km',
      }),
    ).toEqual({ kind: 'energy', unit: 'km', standardUnit: '人・日', isNonStandard: false, isFactorDerived: true });
    // 通勤の公式係数（kg-CO2/人・日）は標準単位 人・日 と一致するため、標準単位のまま
    expect(
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'business_travel_commuting' },
        mode: 'create',
        initial: null,
        productUnit: null,
        factorUnit: 'kg-CO2/人・日',
      }),
    ).toEqual({ kind: 'energy', unit: '人・日', standardUnit: '人・日', isNonStandard: false, isFactorDerived: false });
    // 換算できる組み合わせ（L と tCO2/kL）は標準単位のまま
    expect(
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'fuel' },
        mode: 'create',
        initial: null,
        productUnit: null,
        factorUnit: 'tCO2/kL',
      }),
    ).toEqual({ kind: 'energy', unit: 'L', standardUnit: 'L', isNonStandard: false, isFactorDerived: false });
    // 編集で記録の単位を保持する間は係数から上書きしない（以前に km で保存された記録も単位を保つ）
    expect(
      resolveEntryUnit({
        category: { kind: 'energy', energyType: 'business_travel_commuting' },
        mode: 'edit',
        initial: { energyType: 'business_travel_commuting', unit: 'km' },
        productUnit: null,
        factorUnit: 'kg-CO2/人・日',
      }),
    ).toEqual({ kind: 'energy', unit: 'km', standardUnit: '人・日', isNonStandard: true, isFactorDerived: false });
  });

  it('Scope3 は選択製品の単位（未確定なら null）', () => {
    expect(
      resolveEntryUnit({ category: { kind: 'scope3', categoryId: 1 }, mode: 'create', initial: null, productUnit: null }),
    ).toEqual({ kind: 'scope3', unit: null });
    expect(
      resolveEntryUnit({ category: { kind: 'scope3', categoryId: 1 }, mode: 'edit', initial: null, productUnit: '円' }),
    ).toEqual({ kind: 'scope3', unit: '円' });
  });
});
