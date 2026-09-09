import { describe, expect, it } from 'vitest';
import type { CandidateFactorRow } from '../factorSelectionService';
import {
  DEFAULT_PROVIDER_SELECTION,
  listApplicableProviderFactors,
  listEntryFactorCandidates,
  listMenuOptions,
  resolveAppliedFactor,
  resolveFactorIdToSave,
  resolveProviderFactor,
  resolveSelectedFactor,
  restoreProviderSelection,
  type FactorResolutionScope,
} from '../entryFactorSelection';

// 統合データ入力フォームの係数選択（純関数）のテスト。
// 事業者係数の復元・保存 id の規則・「保存後に実際に適用される係数」の判定を固定する。

const factor = (overrides: Partial<CandidateFactorRow> & { id: string }): CandidateFactorRow => ({
  organizationId: null,
  name: `係数 ${overrides.id}`,
  energyType: 'electricity',
  scope: 'scope2',
  factorValue: 0.0005,
  unit: 't-CO2/kWh',
  applicableYear: 2024,
  regionName: '全国',
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: '2024-04-01',
  effectiveTo: '2025-03-31',
  providerName: null,
  providerNumber: null,
  menuName: null,
  factorType: 'adjusted',
  source: 'moe',
  sourceDocumentName: null,
  ...overrides,
});

const national = factor({ id: 'national', name: '電気（代替値・全国）' });
const kanto = factor({ id: 'kanto', name: '電気（関東）', regionName: '関東' });
const providerAdjusted = factor({
  id: 'tepco-adjusted',
  providerName: ' 東京電力エナジーパートナー ',
  providerNumber: 'A0269',
  factorType: 'adjusted',
  menuName: null,
});
const providerBasic = factor({
  id: 'tepco-basic',
  providerName: '東京電力エナジーパートナー',
  providerNumber: 'A0269',
  factorType: 'basic',
});
const providerMenuA = factor({
  id: 'kepco-a',
  providerName: '関西電力',
  providerNumber: 'A0002',
  factorType: 'adjusted',
  menuName: 'メニューA',
});
const providerMenuB = factor({
  id: 'kepco-b',
  providerName: '関西電力',
  providerNumber: 'A0002',
  factorType: 'adjusted',
  menuName: 'メニューB',
});
const providerFactors = [providerAdjusted, providerBasic, providerMenuA, providerMenuB];

const scope: FactorResolutionScope = {
  location: { id: 'loc-1', name: '本社', region: 'Kanto' },
  energyType: 'electricity',
  periodStart: '2024-11-01',
  applicableYear: 2024,
};

describe('listApplicableProviderFactors', () => {
  // 事業者係数の取得はフォールバック年度も含む。公式係数は年度ごとに同内容の行が生成されるため、
  // 対象年度が公表済みの通常運用では同じ事業者・メニューの行が 2 年分届く。
  const previousYear = (row: CandidateFactorRow): CandidateFactorRow => ({
    ...row,
    id: `${row.id}-2023`,
    applicableYear: 2023,
    effectiveFrom: '2023-04-01',
    effectiveTo: '2024-03-31',
  });
  const fetched = [
    previousYear(providerAdjusted),
    providerAdjusted,
    providerBasic,
    previousYear(providerBasic),
    providerMenuA,
    previousYear(providerMenuA),
  ];

  it('対象年度が公表済みなら過年度の行を落とし、同じ事業者・メニューが重複しない', () => {
    const rows = listApplicableProviderFactors(scope, [national], fetched);
    expect(rows.map((f) => f.id)).toEqual(['tepco-adjusted', 'tepco-basic', 'kepco-a']);
    // メニューが 1 つの事業者は自動確定のまま（メニュー選択が出ない）。
    const options = listMenuOptions(rows, { factorType: 'adjusted', providerName: '関西電力', menuName: null });
    expect(resolveProviderFactor(options, null)?.id).toBe('kepco-a');
  });

  it('対象年度が未公表なら過年度の行を残す（暫定適用）', () => {
    const onlyPrevious = fetched.filter((f) => f.applicableYear === 2023);
    const rows = listApplicableProviderFactors(scope, [], onlyPrevious);
    expect(rows.map((f) => f.id)).toEqual(['tepco-adjusted-2023', 'tepco-basic-2023', 'kepco-a-2023']);
  });

  it('公表済みかは標準係数も含めて判定する（標準係数だけ対象年度にあれば事業者の過年度行は落ちる）', () => {
    const onlyPrevious = fetched.filter((f) => f.applicableYear === 2023);
    expect(listApplicableProviderFactors(scope, [national], onlyPrevious)).toEqual([]);
  });

  it('標準係数の行は返さない', () => {
    expect(listApplicableProviderFactors(scope, [national], [national, providerAdjusted]).map((f) => f.id)).toEqual([
      'tepco-adjusted',
    ]);
  });
});

describe('listMenuOptions / resolveProviderFactor', () => {
  it('事業者名は正規化して突き合わせ、計算方法で絞る', () => {
    const options = listMenuOptions(providerFactors, {
      factorType: 'basic',
      providerName: '東京電力エナジーパートナー',
      menuName: null,
    });
    expect(options.map((f) => f.id)).toEqual(['tepco-basic']);
    expect(listMenuOptions(providerFactors, DEFAULT_PROVIDER_SELECTION)).toEqual([]);
  });

  it('メニュー候補が 1 件なら自動確定、複数なら選択済みメニューで確定する', () => {
    expect(resolveProviderFactor([providerAdjusted], null)?.id).toBe('tepco-adjusted');
    expect(resolveProviderFactor([providerMenuA, providerMenuB], null)).toBeNull();
    expect(resolveProviderFactor([providerMenuA, providerMenuB], 'メニューB')?.id).toBe('kepco-b');
    expect(resolveProviderFactor([], null)).toBeNull();
  });
});

describe('restoreProviderSelection', () => {
  it('保存済みの事業者係数 id から計算方法・事業者（正規化済み）・メニューを復元する', () => {
    expect(restoreProviderSelection(providerFactors, 'tepco-adjusted')).toEqual({
      factorType: 'adjusted',
      providerName: '東京電力エナジーパートナー',
      menuName: null,
    });
    expect(restoreProviderSelection(providerFactors, 'kepco-b')).toEqual({
      factorType: 'adjusted',
      providerName: '関西電力',
      menuName: 'メニューB',
    });
  });

  it('id が無い・null・factorType が null の行は復元しない', () => {
    expect(restoreProviderSelection(providerFactors, null)).toBeNull();
    expect(restoreProviderSelection(providerFactors, 'national')).toBeNull();
    expect(
      restoreProviderSelection([factor({ id: 'x', providerName: 'X', factorType: null })], 'x'),
    ).toBeNull();
  });
});

describe('候補と選択係数', () => {
  it('候補は地域一致を全国より先に並べ、事業者係数は候補に含めない', () => {
    const candidates = listEntryFactorCandidates(scope, [national, kanto, providerAdjusted]);
    expect(candidates.map((f) => f.id)).toEqual(['kanto', 'national']);
  });

  it('選択係数は 事業者確定 > 上書き > 候補先頭 の順で、候補外の上書きは先頭へ戻る', () => {
    const candidates = [kanto, national];
    expect(
      resolveSelectedFactor({ providerFactor: providerAdjusted, candidates, selectedFactorId: 'national' })?.id,
    ).toBe('tepco-adjusted');
    expect(resolveSelectedFactor({ providerFactor: null, candidates, selectedFactorId: 'national' })?.id).toBe(
      'national',
    );
    expect(resolveSelectedFactor({ providerFactor: null, candidates, selectedFactorId: 'archived' })?.id).toBe(
      'kanto',
    );
    expect(resolveSelectedFactor({ providerFactor: null, candidates: [], selectedFactorId: null })).toBeNull();
  });

  it('保存 id は編集で未タッチなら元の指定、それ以外は選択係数', () => {
    expect(
      resolveFactorIdToSave({ isEdit: true, factorTouched: false, initialFactorId: 'tepco-adjusted', selectedFactor: national }),
    ).toBe('tepco-adjusted');
    expect(
      resolveFactorIdToSave({ isEdit: true, factorTouched: true, initialFactorId: 'tepco-adjusted', selectedFactor: national }),
    ).toBe('national');
    expect(resolveFactorIdToSave({ isEdit: false, factorTouched: false, initialFactorId: null, selectedFactor: null })).toBeNull();
  });
});

describe('resolveAppliedFactor', () => {
  it('保存 id が前提フィルタを満たせば tier に関係なく採用する（事業者係数も可）', () => {
    const applied = resolveAppliedFactor({
      scope,
      yearFactors: [national, kanto],
      providerFactors,
      providerLoadStatus: 'ready',
      providerNameSelected: true,
      factorIdToSave: 'tepco-adjusted',
    });
    expect(applied).toEqual({
      status: 'resolved',
      factor: providerAdjusted,
      fellBack: false,
      remapped: false,
      ambiguous: false,
      provisional: false,
    });
  });

  it('保存 id が有効期間外なら候補先頭へフォールバックし fellBack=true', () => {
    const expired = factor({ ...providerAdjusted, effectiveTo: '2024-10-31' });
    const applied = resolveAppliedFactor({
      scope,
      yearFactors: [national, kanto],
      providerFactors: [expired],
      providerLoadStatus: 'ready',
      providerNameSelected: false,
      factorIdToSave: 'tepco-adjusted',
    });
    expect(applied).toEqual({
      status: 'resolved',
      factor: kanto,
      fellBack: true,
      remapped: false,
      ambiguous: false,
      provisional: false,
    });
  });

  it('保存 id の事業者係数が年度更新で外れたら、同一事業者の当年度行へ読み替え remapped=true', () => {
    // 対象年度が未公表の間に暫定適用で保存した前年度の事業者係数。当年度が公表されると前提フィルタを外れる。
    const previous = factor({
      ...providerAdjusted,
      id: 'tepco-adjusted-2023',
      applicableYear: 2023,
      effectiveFrom: '2023-04-01',
      effectiveTo: '2024-03-31',
    });
    const applied = resolveAppliedFactor({
      scope,
      yearFactors: [national, kanto],
      providerFactors: [previous, providerAdjusted],
      providerLoadStatus: 'ready',
      providerNameSelected: false,
      factorIdToSave: 'tepco-adjusted-2023',
    });
    expect(applied).toEqual({
      status: 'resolved',
      factor: providerAdjusted,
      fellBack: true,
      remapped: true,
      ambiguous: false,
      provisional: false,
    });
  });

  it('保存 id が集合に無く事業者係数が取得中なら pending、取得失敗なら unknown', () => {
    expect(
      resolveAppliedFactor({
        scope,
        yearFactors: [national],
        providerFactors: [],
        providerLoadStatus: 'loading',
        providerNameSelected: false,
        factorIdToSave: 'tepco-adjusted',
      }),
    ).toEqual({ status: 'pending' });
    expect(
      resolveAppliedFactor({
        scope,
        yearFactors: [national],
        providerFactors: [],
        providerLoadStatus: 'error',
        providerNameSelected: false,
        factorIdToSave: 'tepco-adjusted',
      }),
    ).toEqual({ status: 'unknown', reason: 'provider' });
  });

  it('供給事業者を選択済みで事業者リストが取得中なら、保存 id が集合内でも pending', () => {
    expect(
      resolveAppliedFactor({
        scope,
        yearFactors: [national, kanto],
        providerFactors: [],
        providerLoadStatus: 'loading',
        providerNameSelected: true,
        factorIdToSave: 'kanto',
      }),
    ).toEqual({ status: 'pending' });
    // 事業者未選択なら取得中でも代替値で判定できる
    expect(
      resolveAppliedFactor({
        scope,
        yearFactors: [national, kanto],
        providerFactors: [],
        providerLoadStatus: 'loading',
        providerNameSelected: false,
        factorIdToSave: null,
      }),
    ).toEqual({ status: 'resolved', factor: kanto, fellBack: false, remapped: false, ambiguous: false, provisional: false });
  });

  it('保存 id が集合に無く事業者係数を持たないカテゴリなら自動解決へ落ちる（archived 等）', () => {
    expect(
      resolveAppliedFactor({
        scope: { ...scope, energyType: 'fuel' },
        yearFactors: [factor({ id: 'fuel-national', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/kL' })],
        providerFactors: [],
        providerLoadStatus: 'none',
        providerNameSelected: false,
        factorIdToSave: 'archived',
      }),
    ).toMatchObject({ status: 'resolved', factor: { id: 'fuel-national' }, fellBack: true, remapped: false, ambiguous: false });
  });

  it('保存 id が null なら候補先頭（自動解決）、候補も無ければ null', () => {
    expect(
      resolveAppliedFactor({ scope, yearFactors: [national, kanto], providerFactors: [], providerLoadStatus: 'none', providerNameSelected: false, factorIdToSave: null }),
    ).toEqual({ status: 'resolved', factor: kanto, fellBack: false, remapped: false, ambiguous: false, provisional: false });
    expect(
      resolveAppliedFactor({ scope, yearFactors: [], providerFactors: [], providerLoadStatus: 'ready', providerNameSelected: false, factorIdToSave: null }),
    ).toEqual({ status: 'resolved', factor: null, fellBack: false, remapped: false, ambiguous: false, provisional: false });
  });

  it('保存 id が無く同順位の候補が名称違いで複数あれば ambiguous（factor は null）、id を選べば解消する', () => {
    const heavyA = factor({ id: 'heavy-a', name: '燃料 A重油', energyType: 'fuel_heavy_oil', scope: 'scope1', unit: 'tCO2/kL', factorType: null });
    const heavyBC = factor({ id: 'heavy-bc', name: '燃料 B・C重油', energyType: 'fuel_heavy_oil', scope: 'scope1', unit: 'tCO2/kL', factorType: null });
    const base = {
      scope: { ...scope, energyType: 'fuel_heavy_oil' as const },
      yearFactors: [heavyA, heavyBC],
      providerFactors: [],
      providerLoadStatus: 'none' as const,
      providerNameSelected: false,
    };
    expect(resolveAppliedFactor({ ...base, factorIdToSave: null })).toEqual({
      status: 'resolved',
      factor: null,
      fellBack: false,
      remapped: false,
      ambiguous: true,
      provisional: false,
    });
    expect(resolveAppliedFactor({ ...base, factorIdToSave: 'heavy-bc' })).toEqual({
      status: 'resolved',
      factor: heavyBC,
      fellBack: false,
      remapped: false,
      ambiguous: false,
      provisional: false,
    });
  });
});

describe('resolveAppliedFactor 未公表年度の暫定適用', () => {
  const previousYear = factor({
    id: 'national-2023',
    name: '電気（代替値・全国）2023',
    applicableYear: 2023,
    effectiveFrom: '2023-04-01',
    effectiveTo: '2024-03-31',
  });

  it('対象年度の係数が無ければ前年度を暫定適用し、provisional を立てる', () => {
    const applied = resolveAppliedFactor({
      scope,
      yearFactors: [previousYear],
      providerFactors: [],
      providerLoadStatus: 'none',
      providerNameSelected: false,
      factorIdToSave: null,
    });
    expect(applied).toMatchObject({
      status: 'resolved',
      provisional: true,
    });
    expect(applied.status === 'resolved' && applied.factor?.id).toBe('national-2023');
  });

  it('対象年度の係数があれば provisional は立たない', () => {
    const applied = resolveAppliedFactor({
      scope,
      yearFactors: [previousYear, national],
      providerFactors: [],
      providerLoadStatus: 'none',
      providerNameSelected: false,
      factorIdToSave: null,
    });
    expect(applied).toMatchObject({
      status: 'resolved',
      provisional: false,
    });
    expect(applied.status === 'resolved' && applied.factor?.id).toBe('national');
  });

  it('係数が解決できなければ provisional は立たない', () => {
    const applied = resolveAppliedFactor({
      scope,
      yearFactors: [],
      providerFactors: [],
      providerLoadStatus: 'none',
      providerNameSelected: false,
      factorIdToSave: null,
    });
    expect(applied).toMatchObject({ status: 'resolved', factor: null, provisional: false });
  });
});
