import { describe, expect, it } from 'vitest';
import {
  buildLocationDetailData,
  getEnergyTypeLabel,
  type DetailActivityRecord,
  type DetailEmissionResult,
} from '../locationDetailAggregation';

describe('getEnergyTypeLabel', () => {
  it('データ入力機能の正本と同じ日本語ラベルを返す', () => {
    expect(getEnergyTypeLabel('electricity')).toBe('電気');
    expect(getEnergyTypeLabel('city_gas')).toBe('ガス');
    expect(getEnergyTypeLabel('fuel_diesel')).toBe('軽油');
  });

  it('未知の種別はDB値をそのまま返す（表示を壊さない）', () => {
    // DBの enum に将来値が追加されてもラベル未定義で落ちないことを固定する。
    expect(getEnergyTypeLabel('unknown_type' as never)).toBe('unknown_type');
  });
});

describe('buildLocationDetailData', () => {
  const records: DetailActivityRecord[] = [
    { id: 'ar-elec-apr', energyType: 'electricity', amount: 1000, unit: 'kWh', periodStart: '2024-04-01' },
    { id: 'ar-elec-may', energyType: 'electricity', amount: '500', unit: 'kWh', periodStart: '2024-05-01' },
    { id: 'ar-gas-apr', energyType: 'city_gas', amount: 200, unit: 'm³', periodStart: '2024-04-01' },
    { id: 'ar-waste-mar', energyType: 'waste', amount: 3, unit: 't', periodStart: '2025-03-01' },
  ];

  const results: DetailEmissionResult[] = [
    { activityRecordId: 'ar-elec-apr', scope: 'scope2', emissions: 40 },
    { activityRecordId: 'ar-elec-may', scope: 'scope2', emissions: '20' },
    { activityRecordId: 'ar-gas-apr', scope: 'scope1', emissions: 30 },
    { activityRecordId: 'ar-waste-mar', scope: 'scope3', emissions: 10 },
  ];

  it('Scope別の年間合計を組み立てる', () => {
    const data = buildLocationDetailData(records, results);

    expect(data.totals.scope1).toBe(30);
    expect(data.totals.scope2).toBe(60);
    expect(data.totals.scope3).toBe(10);
    expect(data.totals.total).toBe(100);
    expect(data.hasScope3).toBe(true);
    expect(data.hasData).toBe(true);
  });

  it('月別×Scope別の内訳を組み立てる（4月=先頭 … 3月=末尾）', () => {
    const data = buildLocationDetailData(records, results);

    expect(data.monthlyData).toHaveLength(12);
    expect(data.monthlyData[0]).toEqual({ name: '4月', scope1: 30, scope2: 40, scope3: 0 });
    expect(data.monthlyData[1]).toEqual({ name: '5月', scope1: 0, scope2: 20, scope3: 0 });
    expect(data.monthlyData[11]).toEqual({ name: '3月', scope1: 0, scope2: 0, scope3: 10 });
  });

  it('エネルギー種別ごとに活動量と排出量を集計し、排出量の多い順に並べる', () => {
    const data = buildLocationDetailData(records, results);

    expect(data.energyBreakdown.map(row => row.energyType)).toEqual([
      'electricity',
      'city_gas',
      'waste',
    ]);

    const electricity = data.energyBreakdown[0];
    expect(electricity.label).toBe('電気');
    expect(electricity.amounts).toEqual([{ unit: 'kWh', amount: 1500 }]);
    expect(electricity.emissions).toBe(60);
    expect(electricity.percent).toBeCloseTo(60);

    const cityGas = data.energyBreakdown[1];
    expect(cityGas.amounts).toEqual([{ unit: 'm³', amount: 200 }]);
    expect(cityGas.emissions).toBe(30);
    expect(cityGas.percent).toBeCloseTo(30);
  });

  it('同一種別で単位が混在しても単位ごとに分けて合算する', () => {
    const mixedUnits: DetailActivityRecord[] = [
      { id: 'ar-1', energyType: 'fuel', amount: 100, unit: 'L', periodStart: '2024-04-01' },
      { id: 'ar-2', energyType: 'fuel', amount: 2, unit: 'kL', periodStart: '2024-05-01' },
      { id: 'ar-3', energyType: 'fuel', amount: 50, unit: 'L', periodStart: '2024-06-01' },
    ];
    const data = buildLocationDetailData(mixedUnits, []);

    expect(data.energyBreakdown).toHaveLength(1);
    expect(data.energyBreakdown[0].amounts).toEqual([
      { unit: 'L', amount: 150 },
      { unit: 'kL', amount: 2 },
    ]);
  });

  it('排出結果が無い（算定未実行の）活動量も排出量0の行として内訳に残す', () => {
    const data = buildLocationDetailData(records, []);

    expect(data.energyBreakdown).toHaveLength(3);
    expect(data.energyBreakdown.every(row => row.emissions === 0)).toBe(true);
    expect(data.energyBreakdown.every(row => row.percent === 0)).toBe(true);
    expect(data.totals.total).toBe(0);
    expect(data.hasScope3).toBe(false);
    expect(data.hasData).toBe(true);
  });

  it('活動量レコードに紐づかない排出結果は全集計から除外する', () => {
    const noisy: DetailEmissionResult[] = [
      ...results,
      { activityRecordId: null, scope: 'scope1', emissions: 999 },
      { activityRecordId: 'unknown', scope: 'scope2', emissions: 999 },
    ];
    const data = buildLocationDetailData(records, noisy);

    expect(data.totals.total).toBe(100);
    expect(data.monthlyData[0]).toEqual({ name: '4月', scope1: 30, scope2: 40, scope3: 0 });
  });

  it('期間が不正な活動量は月別集計に入れないが、年間合計・内訳には含める', () => {
    const invalidPeriod: DetailActivityRecord[] = [
      { id: 'ar-bad', energyType: 'electricity', amount: 100, unit: 'kWh', periodStart: 'invalid' },
    ];
    const badResults: DetailEmissionResult[] = [
      { activityRecordId: 'ar-bad', scope: 'scope2', emissions: 5 },
    ];
    const data = buildLocationDetailData(invalidPeriod, badResults);

    expect(data.monthlyData.every(point => point.scope1 === 0 && point.scope2 === 0 && point.scope3 === 0)).toBe(true);
    expect(data.totals.scope2).toBe(5);
    expect(data.energyBreakdown[0].emissions).toBe(5);
  });

  it('活動量データが無い拠点でも0値で破綻しない（空状態の判定）', () => {
    const data = buildLocationDetailData([], []);

    expect(data.hasData).toBe(false);
    expect(data.hasScope3).toBe(false);
    expect(data.totals).toEqual({ scope1: 0, scope2: 0, scope3: 0, total: 0 });
    expect(data.monthlyData).toHaveLength(12);
    expect(data.energyBreakdown).toEqual([]);
  });
});
