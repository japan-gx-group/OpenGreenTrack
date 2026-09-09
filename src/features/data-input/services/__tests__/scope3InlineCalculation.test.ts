// 受け入れ条件「インライン概算が保存後の算定（§4.3）と同じ値を出す」の担保。
// 概算（computeEstimatedScope3Emissions）と算定バッチの実体（computeScope3Emissions）を
// 直接 import し、同じ入力に対して排出量が完全一致することを確認する。
// 値は IDEA の実データではなくダミー（設計書 §0.1: 実データ値をテストに入れない）。

import { describe, expect, it } from 'vitest';
import type {
  ActivityRecordRow,
  IdeaFactorRow,
  IdeaImportRow,
} from '@/features/calculation/types';
import { computeScope3Emissions } from '@/features/calculation/services/scope3Calculation';
import {
  computeEstimatedScope3Emissions,
  toIdeaFactorValue,
} from '../scope3InlineCalculation';

const APPLICABLE_YEAR = 2026;

const ideaFactor = (overrides: Partial<IdeaFactorRow> = {}): IdeaFactorRow => ({
  id: 'idea-fac-1',
  organizationId: 'org-1',
  importId: 'idea-imp-1',
  ideaCode: '999999999mJPN',
  productName: 'ダミー製品',
  baseFlowAmount: 1,
  unit: 'kg',
  gwpValue: 0.123456789,
  ...overrides,
});

const ideaImport: IdeaImportRow = { id: 'idea-imp-1', version: 'Ver.X.X ダミー版' };

const scope3Record = (
  amount: number,
  unit: string,
  factorId = 'idea-fac-1',
): ActivityRecordRow => ({
  id: 'act-s3-1',
  organizationId: 'org-1',
  locationId: 'loc-1',
  energyType: 'scope3_activity',
  amount,
  unit,
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  isCalculated: false,
  emissionFactorId: null,
  scope3CategoryId: 1,
  ideaFactorId: factorId,
});

/** 概算と算定バッチを同じ入力で実行し、両方の排出量を返す */
const runBoth = (amount: number, factor: IdeaFactorRow) => {
  const estimated = computeEstimatedScope3Emissions(amount, factor, APPLICABLE_YEAR);
  const { results, unresolved } = computeScope3Emissions(
    [scope3Record(amount, factor.unit, factor.id)],
    [factor],
    [ideaImport],
    APPLICABLE_YEAR,
  );
  return { estimated, results, unresolved };
};

describe('computeEstimatedScope3Emissions と保存後の算定（computeScope3Emissions）の等価性', () => {
  it('kg 単位の製品で保存後の算定と同じ値になる', () => {
    const { estimated, results, unresolved } = runBoth(1000, ideaFactor());
    expect(unresolved).toEqual([]);
    expect(results).toHaveLength(1);
    // 1000 kg × 0.123456789 kg-CO2e/kg = 123.456789 kg-CO2e = 0.123456789 t → 第6位丸め
    expect(estimated).toBe(0.123457);
    expect(estimated).toBe(results[0].emissions);
  });

  it('円単位原単位（1e-9 t/円オーダー）でも保存後の算定と同じ値になる', () => {
    const factor = ideaFactor({ gwpValue: '0.00000123456789', unit: '円' });
    const { estimated, results, unresolved } = runBoth(10_000_000, factor);
    expect(unresolved).toEqual([]);
    expect(estimated).toBe(0.012346);
    expect(estimated).toBe(results[0].emissions);
  });

  it('gwpValue / baseFlowAmount が string（無制約 numeric）でも一致する', () => {
    const factor = ideaFactor({ gwpValue: '10.5', baseFlowAmount: '4', unit: 'kWh' });
    const { estimated, results } = runBoth(3.7, factor);
    // 3.7 kWh × (10.5 / 4) kg-CO2e/kWh = 9.7125 kg = 0.0097125 t → 0.009713（切り上げ側の丸め）
    expect(estimated).toBe(0.009713);
    expect(estimated).toBe(results[0].emissions);
  });

  it('第6位丸めの境界（0.5kg 未満の小口明細）でもゼロ落ちせず一致する', () => {
    const factor = ideaFactor({ gwpValue: '0.001', unit: 'kg' });
    // 0.4 kg × 0.001 kg-CO2e/kg = 0.0000004 t → 第6位丸めは Math.round で 0.000000（偶数丸めではない）
    const { estimated, results } = runBoth(0.4, factor);
    expect(estimated).toBe(results[0].emissions);
    // 1kg 丸め（第3位）ならゼロ落ちしていた小口でも 1g 粒度で残るケース
    const { estimated: small, results: smallResults } = runBoth(400, factor);
    expect(small).toBe(0.0004);
    expect(small).toBe(smallResults[0].emissions);
  });

  it('端数の多い活動量でも一致する（丸め順序の回帰）', () => {
    const factor = ideaFactor({ gwpValue: '2.71828182845', unit: 't-km' });
    const { estimated, results } = runBoth(123.456, factor);
    expect(estimated).not.toBeNull();
    expect(estimated).toBe(results[0].emissions);
  });

  it('単位は製品から自動設定される（= 常に factor.unit を渡す）ため換算は必ず 1:1 で成立する', () => {
    // 保存フローも同じ前提（activity_records.unit = 選択製品の unit）のため、
    // 概算・算定バッチの双方で UNIT_MISMATCH は発生しない。
    for (const unit of ['kg', 't', 'kWh', '円', 't-km', 'm3']) {
      const factor = ideaFactor({ unit });
      const { estimated, results, unresolved } = runBoth(12.5, factor);
      expect(unresolved).toEqual([]);
      expect(estimated).not.toBeNull();
      expect(estimated).toBe(results[0].emissions);
    }
  });
});

describe('toIdeaFactorValue', () => {
  it('正規化（normalizeIdeaFactor）と同じ式で原単位を返す', () => {
    expect(toIdeaFactorValue({ gwpValue: '10.5', baseFlowAmount: '4' })).toBe(2.625);
    expect(toIdeaFactorValue({ gwpValue: 0.123456789, baseFlowAmount: 1 })).toBe(0.123456789);
  });
});
