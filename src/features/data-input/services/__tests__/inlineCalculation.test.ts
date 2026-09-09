import { describe, expect, it } from 'vitest';
import type { EmissionFactorRow } from '@/features/calculation/types';
import {
  applicableYearForDate,
  collectFiscalYearIdsForPeriodStarts,
  computeEstimatedEmissions,
  findFiscalYearForDate,
  type FiscalYearRange,
} from '../inlineCalculation';

const ORG = 'org-1';

const factor = (overrides: Partial<EmissionFactorRow> = {}): EmissionFactorRow => ({
  id: 'fac-national',
  organizationId: ORG,
  name: '電気（標準）',
  energyType: 'electricity',
  scope: 'scope2',
  factorValue: 0.0005,
  unit: 't-CO2e/kWh',
  applicableYear: 2024,
  regionName: '全国',
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: null,
  effectiveTo: null,
  providerName: null,
  providerNumber: null,
  menuName: null,
  factorType: null,
  ...overrides,
});

// 4月始まりの標準的な会計年度マスタ
const fiscalYears: FiscalYearRange[] = [
  { id: 'fy-2024', startDate: '2024-04-01', endDate: '2025-03-31' },
  { id: 'fy-2023', startDate: '2023-04-01', endDate: '2024-03-31' },
];

describe('findFiscalYearForDate / applicableYearForDate', () => {
  it('期間内の日付は該当する会計年度を返す', () => {
    expect(findFiscalYearForDate(fiscalYears, '2024-05-01')?.id).toBe('fy-2024');
    expect(findFiscalYearForDate(fiscalYears, '2024-03-31')?.id).toBe('fy-2023');
  });

  it('どの会計年度にも属さない日付は null を返す', () => {
    expect(findFiscalYearForDate(fiscalYears, '2020-01-01')).toBeNull();
  });

  it('適用年度は会計年度の開始年を正とする（算定バッチと同じ基準）', () => {
    expect(applicableYearForDate(fiscalYears, '2024-05-01')).toBe(2024);
    // 2025年1月は fy-2024（2024-04-01 開始）に属するため 2024 年度
    expect(applicableYearForDate(fiscalYears, '2025-01-15')).toBe(2024);
  });

  it('該当する会計年度が無い場合は periodStart から4月始まりで導出する', () => {
    expect(applicableYearForDate(fiscalYears, '2020-05-01')).toBe(2020);
    expect(applicableYearForDate(fiscalYears, '2020-02-01')).toBe(2019);
  });
});

describe('collectFiscalYearIdsForPeriodStarts', () => {
  it('複数の periodStart から対象の会計年度IDを重複なく集める', () => {
    const { fiscalYearIds, uncoveredCount } = collectFiscalYearIdsForPeriodStarts(fiscalYears, [
      '2024-04-01',
      '2024-05-01',
      '2024-03-01',
    ]);
    expect(fiscalYearIds.sort()).toEqual(['fy-2023', 'fy-2024']);
    expect(uncoveredCount).toBe(0);
  });

  it('どの会計年度にも属さない日付は uncoveredCount に数える', () => {
    const { fiscalYearIds, uncoveredCount } = collectFiscalYearIdsForPeriodStarts(fiscalYears, [
      '2024-05-01',
      '2020-01-01',
    ]);
    expect(fiscalYearIds).toEqual(['fy-2024']);
    expect(uncoveredCount).toBe(1);
  });
});

describe('computeEstimatedEmissions', () => {
  it('活動量 × 係数 を小数第3位丸めの t-CO2e で返す', () => {
    expect(computeEstimatedEmissions(245780, 'kWh', factor())).toBe(122.89);
  });

  it('同一次元の単位（MWh→kWh）は換算して計算する', () => {
    expect(computeEstimatedEmissions(1, 'MWh', factor())).toBe(0.5);
  });

  it('換算できない単位の組み合わせは null を返す', () => {
    expect(computeEstimatedEmissions(100, 'kg', factor())).toBeNull();
  });
});
