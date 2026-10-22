import { describe, expect, it, vi } from 'vitest';
import type { ManualEntryLocationOption } from '../../types';
import type { CandidateFactorRow } from '../factorSelectionService';
import { normalizeProviderName } from '../providerOptions';
import { resolveBulkMonthFactors } from '../bulkFactorResolution';

// 非4月始まり（1月開始）の会計年度では、年度内の月が温対法年度の境界（3月→4月）をまたぐ。
// 公式係数（事業者別・標準とも）は温対法年度＋有効期間で管理されるため、同じ事業者・メニューでも
// 月によって適用できる係数の行（ID）が変わることを、この解決サービスが吸収することを固定する。

const LOCATION: ManualEntryLocationOption = { id: 'loc-1', name: '大阪支社', region: 'Kanto' };
const TEPCO = '東京電力エナジーパートナー';

const factor = (
  overrides: Pick<CandidateFactorRow, 'id' | 'name' | 'factorValue' | 'applicableYear'> &
    Partial<CandidateFactorRow>,
): CandidateFactorRow => ({
  organizationId: null,
  energyType: 'electricity',
  scope: 'scope2',
  unit: 't-CO2/kWh',
  regionName: '全国',
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: `${overrides.applicableYear}-04-01`,
  effectiveTo: `${overrides.applicableYear + 1}-03-31`,
  providerName: null,
  providerNumber: null,
  menuName: null,
  factorType: 'adjusted',
  source: 'moe',
  sourceDocumentName: null,
  ...overrides,
});

const national2024 = factor({ id: 'national-2024', name: '電気（代替値）', factorValue: 0.00045, applicableYear: 2024 });
const national2025 = factor({ id: 'national-2025', name: '電気（代替値）', factorValue: 0.00044, applicableYear: 2025 });
const tepco2024 = factor({
  id: 'tepco-2024',
  name: `${TEPCO}（調整後）`,
  factorValue: 0.0004,
  applicableYear: 2024,
  providerName: TEPCO,
  providerNumber: 'A0269',
  source: 'utility',
});
const tepco2025 = factor({
  id: 'tepco-2025',
  name: `${TEPCO}（調整後）`,
  factorValue: 0.00039,
  applicableYear: 2025,
  providerName: TEPCO,
  providerNumber: 'A0269',
  source: 'utility',
});

// 2024 年度の係数行しか無い事業者（翌年度の公表前・撤退など）。
const KEPCO = '関西電力';
const kepco2024 = factor({
  id: 'kepco-2024',
  name: `${KEPCO}（調整後）`,
  factorValue: 0.00035,
  applicableYear: 2024,
  providerName: KEPCO,
  providerNumber: 'A0001',
  source: 'utility',
});

const yearPool = [national2024, national2025];
const providerPool = [tepco2024, tepco2025, kepco2024];

const fetchers = () => {
  const fetchYearFactors = vi.fn(async (years: number[]) =>
    yearPool.filter((row) => years.includes(row.applicableYear)),
  );
  const fetchProviderFactors = vi.fn(async (_energyType: string, year: number) =>
    providerPool.filter((row) => row.applicableYear === year),
  );
  return { fetchYearFactors, fetchProviderFactors };
};

// 1月開始の会計年度 2025（2025-01-01〜2025-12-31）。2025-02 は温対法 2024 年度、2025-04 は 2025 年度。
const FISCAL_YEARS = [{ id: 'fy2025', startDate: '2025-01-01', endDate: '2025-12-31' }];

describe('resolveBulkMonthFactors', () => {
  it('事業者選択は月の温対法年度ごとに同事業者の係数行へ読み替える', async () => {
    const result = await resolveBulkMonthFactors({
      months: ['2025-02', '2025-04'],
      location: LOCATION,
      energyType: 'electricity',
      fiscalYears: FISCAL_YEARS,
      selection: {
        providerSelection: {
          factorType: 'adjusted',
          providerName: normalizeProviderName(TEPCO),
          menuName: null,
        },
        selectedFactorId: null,
      },
      fetchers: fetchers(),
    });
    expect(result.get('2025-02')?.factorIdToSave).toBe('tepco-2024');
    expect(result.get('2025-04')?.factorIdToSave).toBe('tepco-2025');
    const applied = result.get('2025-04')?.applied;
    expect(applied?.status === 'resolved' && applied.factor?.id).toBe('tepco-2025');
    expect(applied?.status === 'resolved' && applied.fellBack).toBe(false);
    expect(result.get('2025-02')?.providerFellBack).toBe(false);
    expect(result.get('2025-04')?.providerFellBack).toBe(false);
  });

  it('選択した事業者の係数行が無い月は代替値（自動選択）へ落とし、その月だけフォールバックを立てる', async () => {
    const result = await resolveBulkMonthFactors({
      months: ['2025-02', '2025-04'],
      location: LOCATION,
      energyType: 'electricity',
      fiscalYears: FISCAL_YEARS,
      selection: {
        providerSelection: {
          factorType: 'adjusted',
          providerName: normalizeProviderName(KEPCO),
          menuName: null,
        },
        selectedFactorId: null,
      },
      fetchers: fetchers(),
    });
    expect(result.get('2025-02')).toMatchObject({ factorIdToSave: 'kepco-2024', providerFellBack: false });
    // 2025 年度には関西電力の行が無いため、その月は代替値を保存し、確認モーダルで知らせる。
    const fallen = result.get('2025-04');
    expect(fallen).toMatchObject({ factorIdToSave: 'national-2025', providerFellBack: true });
    // 保存する id 自体が代替値なので算定上の「指定どおりに使われない」フォールバックにはならない。
    expect(fallen?.applied.status === 'resolved' && fallen.applied.fellBack).toBe(false);
  });

  it('標準係数の上書き選択は、その月の候補に無ければ自動選択へ戻す', async () => {
    const result = await resolveBulkMonthFactors({
      months: ['2025-02', '2025-04'],
      location: LOCATION,
      energyType: 'electricity',
      fiscalYears: FISCAL_YEARS,
      selection: {
        providerSelection: { factorType: 'adjusted', providerName: null, menuName: null },
        selectedFactorId: 'national-2024',
      },
      fetchers: fetchers(),
    });
    expect(result.get('2025-02')?.factorIdToSave).toBe('national-2024');
    // 2025-04 の候補に national-2024 は無い（有効期間外）ため、その月の自動選択（候補先頭）へ。
    expect(result.get('2025-04')?.factorIdToSave).toBe('national-2025');
  });

  it('同じ年度集合の月は係数マスタの取得を共有する', async () => {
    const injected = fetchers();
    await resolveBulkMonthFactors({
      months: ['2025-04', '2025-05', '2025-06'],
      location: LOCATION,
      energyType: 'electricity',
      fiscalYears: FISCAL_YEARS,
      selection: {
        providerSelection: { factorType: 'adjusted', providerName: null, menuName: null },
        selectedFactorId: null,
      },
      fetchers: injected,
    });
    expect(injected.fetchYearFactors).toHaveBeenCalledTimes(1);
    expect(injected.fetchProviderFactors).toHaveBeenCalledTimes(1);
  });
});
