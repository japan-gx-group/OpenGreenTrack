import { describe, expect, it, vi } from 'vitest';
import type { CandidateFactorRow } from '@/features/data-input/services/factorSelectionService';
import type { ManualEntryLocationOption } from '@/features/data-input/types';
import { createFactorCatalog, resolveRowFactor, type RowFactorChoice } from '../rowFactorResolution';

// 一括登録の表の 1 行の排出係数: 事業者とメニューで決まればその係数、メニューが決まらなければ代替値（候補の先頭）、
// 標準係数は読取りで決めた名前か、選び直した ID で選ぶ。係数マスタは年度ごとに 1 回だけ取得し、失敗したら取り直す。

const TOKYO: ManualEntryLocationOption = { id: 'tokyo', name: '東京本社', region: 'Kanto' };
const TEPCO = '東京電力エナジーパートナー(株)';
const FISCAL_YEARS = [{ id: 'fy2025', startDate: '2025-04-01', endDate: '2026-03-31' }];

const factor = (overrides: Partial<CandidateFactorRow> & Pick<CandidateFactorRow, 'id' | 'name'>): CandidateFactorRow => ({
  organizationId: null,
  energyType: 'electricity',
  scope: 'scope2',
  factorValue: 0.0004,
  unit: 't-CO2/kWh',
  applicableYear: 2025,
  regionName: '全国',
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: '2025-04-01',
  effectiveTo: '2026-03-31',
  providerName: null,
  providerNumber: null,
  menuName: null,
  factorType: 'adjusted',
  source: 'moe',
  sourceDocumentName: null,
  ...overrides,
});

const NATIONAL = factor({ id: 'national', name: '電気 代替値（全国）', factorValue: 0.00044 });
const provider = { providerName: TEPCO, providerNumber: 'A0269', source: 'utility' as const };
const MENU_A = factor({ id: 'tepco-a', name: `${TEPCO} メニューA`, menuName: 'メニューA', factorValue: 0.0003, ...provider });
const MENU_L = factor({ id: 'tepco-l', name: `${TEPCO} メニューL(残差)`, menuName: 'メニューL(残差)', ...provider });
const fuel = { energyType: 'fuel_gasoline' as const, scope: 'scope1' as const, unit: 't-CO2/kL' };
const GASOLINE = factor({ id: 'gasoline', name: '燃料 揮発油', factorValue: 2.29, ...fuel });
const GASOLINE_OTHER = factor({ id: 'gasoline-other', name: '燃料 揮発油（別の公表値）', factorValue: 2.32, ...fuel });

const fetchers = () => ({
  fetchYearFactors: vi.fn(async (years: number[]) =>
    [NATIONAL, GASOLINE, GASOLINE_OTHER].filter((row) => years.includes(row.applicableYear)),
  ),
  fetchProviderFactors: vi.fn(async (_energyType: string, year: number) =>
    [MENU_A, MENU_L].filter((row) => row.applicableYear === year),
  ),
});

const CHOICE: RowFactorChoice = { providerName: null, menuName: null, factorName: null, selectedFactorId: null };

const resolve = (
  catalog: ReturnType<typeof createFactorCatalog>,
  energyType: 'electricity' | 'fuel_gasoline',
  choice: Partial<RowFactorChoice>,
) =>
  resolveRowFactor({
    energyType,
    targetMonth: '2025-09',
    location: TOKYO,
    fiscalYears: FISCAL_YEARS,
    choice: { ...CHOICE, ...choice },
    catalog,
  });

describe('resolveRowFactor', () => {
  it('事業者とメニューで決まった係数を保存し、適用される係数もその係数にする', async () => {
    const view = await resolve(createFactorCatalog(fetchers()), 'electricity', { providerName: TEPCO, menuName: 'メニューL(残差)' });

    expect(view.isProvider).toBe(true);
    expect(view.menuOptions.map((row) => row.id)).toEqual(['tepco-a', 'tepco-l']);
    expect(view.providerFactor?.id).toBe('tepco-l');
    expect(view.factorIdToSave).toBe('tepco-l');
    expect(view.applied).toMatchObject({ status: 'resolved', factor: { id: 'tepco-l' } });
    expect(view.providerOptions.length).toBeGreaterThan(0);
  });

  it('メニューが決まらなければ、代替値（候補の先頭）を保存する', async () => {
    const view = await resolve(createFactorCatalog(fetchers()), 'electricity', { providerName: TEPCO, menuName: null });

    expect(view.providerFactor).toBeNull();
    expect(view.candidates.map((row) => row.id)).toEqual(['national']);
    expect(view.factorIdToSave).toBe('national');
    expect(view.applied).toMatchObject({ status: 'resolved', factor: { id: 'national' } });
  });

  it('燃料は事業者別係数を取得せず、読取りで決めた名前の係数を選ぶ。選び直した ID があればそちらを使う', async () => {
    const source = fetchers();
    const catalog = createFactorCatalog(source);

    const byName = await resolve(catalog, 'fuel_gasoline', { factorName: '燃料 揮発油（別の公表値）' });
    expect(byName.isProvider).toBe(false);
    expect(byName.factorIdToSave).toBe('gasoline-other');
    expect(source.fetchProviderFactors).not.toHaveBeenCalled();

    const byId = await resolve(catalog, 'fuel_gasoline', { factorName: '燃料 揮発油（別の公表値）', selectedFactorId: 'gasoline' });
    expect(byId.factorIdToSave).toBe('gasoline');

    // 名前が候補に無ければ、候補の先頭（自動選択）に戻す。
    const unknown = await resolve(catalog, 'fuel_gasoline', { factorName: '燃料 軽油' });
    expect(unknown.factorIdToSave).toBe(unknown.candidates[0].id);
  });
});

describe('createFactorCatalog', () => {
  it('同じ年度の係数は 1 回だけ取得し、表の行で共有する', async () => {
    const source = fetchers();
    const catalog = createFactorCatalog(source);

    await Promise.all([
      resolve(catalog, 'electricity', { providerName: TEPCO }),
      resolve(catalog, 'electricity', {}),
      resolve(catalog, 'fuel_gasoline', {}),
    ]);

    expect(source.fetchYearFactors).toHaveBeenCalledTimes(1);
    expect(source.fetchProviderFactors).toHaveBeenCalledTimes(1);
    expect(source.fetchProviderFactors).toHaveBeenCalledWith('electricity', 2025);
  });

  it('取得に失敗したら覚えず、次に呼ばれたときに取り直す', async () => {
    const source = fetchers();
    source.fetchYearFactors.mockRejectedValueOnce(new Error('network'));
    const catalog = createFactorCatalog(source);

    await expect(resolve(catalog, 'fuel_gasoline', {})).rejects.toThrow('network');
    await expect(resolve(catalog, 'fuel_gasoline', {})).resolves.toMatchObject({ isProvider: false });
    expect(source.fetchYearFactors).toHaveBeenCalledTimes(2);
  });
});
