// Scope3積上げ算定（IDEA連携）の回帰テスト（docs/idea-scope3-spec.md §6）。
//   - providerName='IDEA' 正規化により自動解決候補に決して入らないこと
//   - 孤児レコード（ideaFactorId=null）が他の IDEA 係数へ誤マッチしないこと
//   - FK 詰め替え（emissionFactorId=null / ideaFactorId セット）
//   - categoryId の伝播（select 欠落で null 保存されると §5.1 の集計が黙って 0 になる）
//   - 円単位原単位（1e-9 t-CO2e/円 オーダー）の桁落ちなし
//   - appliedFactorName が最大長（ideaCode 30 + productName 300 + version 100）で切れないこと

import { describe, expect, it } from 'vitest';
import type {
  ActivityRecordRow,
  EmissionFactorRow,
  EmissionResultInsert,
  IdeaFactorRow,
  IdeaImportRow,
} from '../../types';
import { computeEmissions } from '../../engine/computeEmissions';
import {
  listFactorCandidates,
  resolveEmissionFactor,
} from '../../engine/resolveEmissionFactor';
import {
  SCOPE3_FACTOR_MISSING_MESSAGE,
  computeScope3Emissions,
  normalizeIdeaFactor,
  toScope3Insert,
} from '../scope3Calculation';

const APPLICABLE_YEAR = 2026;

const scope3Record = (overrides: Partial<ActivityRecordRow> = {}): ActivityRecordRow => ({
  id: 'act-s3-1',
  organizationId: 'org-1',
  locationId: 'loc-1',
  energyType: 'scope3_activity',
  amount: 1000,
  unit: 'kg',
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  isCalculated: false,
  emissionFactorId: null,
  scope3CategoryId: 1,
  ideaFactorId: 'idea-fac-1',
  ...overrides,
});

const ideaFactor = (overrides: Partial<IdeaFactorRow> = {}): IdeaFactorRow => ({
  id: 'idea-fac-1',
  organizationId: 'org-1',
  importId: 'idea-imp-1',
  ideaCode: '999999999mJPN',
  productName: 'ダミー製品',
  baseFlowAmount: 1,
  unit: 'kg',
  gwpValue: 0.0903508069,
  ...overrides,
});

const ideaImport = (overrides: Partial<IdeaImportRow> = {}): IdeaImportRow => ({
  id: 'idea-imp-1',
  version: 'Ver.4.0 標準版',
  ...overrides,
});

describe('normalizeIdeaFactor', () => {
  it('§4.3-2 のとおり EmissionFactorRow へ正規化する（providerName=IDEA・regionName 空）', () => {
    const normalized = normalizeIdeaFactor(ideaFactor(), APPLICABLE_YEAR);

    expect(normalized).toEqual({
      id: 'idea-fac-1',
      organizationId: 'org-1',
      name: '999999999mJPN ダミー製品',
      energyType: 'scope3_activity',
      scope: 'scope3',
      factorValue: 0.0903508069,
      unit: 'kg-CO2e/kg',
      applicableYear: APPLICABLE_YEAR,
      regionName: '',
      status: 'active',
      isCustom: false,
      locationId: null,
      supplierId: null,
      effectiveFrom: null,
      effectiveTo: null,
      providerName: 'IDEA',
      providerNumber: null,
      menuName: null,
      factorType: null,
    } satisfies EmissionFactorRow);
  });

  it('gwpValue / baseFlowAmount が string（無制約 numeric）でも数値化して割る', () => {
    const normalized = normalizeIdeaFactor(
      ideaFactor({ gwpValue: '10.5', baseFlowAmount: '4' }),
      APPLICABLE_YEAR,
    );
    expect(normalized.factorValue).toBe(2.625);
  });

  it('円単位原単位（kg-CO2e/円）が桁落ちせずに正規化される', () => {
    // 1.23456789e-6 kg-CO2e/円 = 1.23456789e-9 t-CO2e/円（有効桁9桁）
    const normalized = normalizeIdeaFactor(
      ideaFactor({ gwpValue: '0.00000123456789', unit: '円' }),
      APPLICABLE_YEAR,
    );
    expect(normalized.factorValue).toBe(1.23456789e-6);
    expect(normalized.unit).toBe('kg-CO2e/円');
  });

  it('自動解決の候補には決して入らない（providerName=IDEA → tier Infinity）', () => {
    const normalized = [
      normalizeIdeaFactor(ideaFactor(), APPLICABLE_YEAR),
      normalizeIdeaFactor(ideaFactor({ id: 'idea-fac-2', ideaCode: '022200000mJPN' }), APPLICABLE_YEAR),
    ];
    // 明示指定なしの Scope3 レコード（孤児相当）に対して候補ゼロ
    const orphan = scope3Record({ emissionFactorId: null, ideaFactorId: null });
    expect(
      listFactorCandidates(orphan, normalized, { applicableYear: APPLICABLE_YEAR }),
    ).toEqual([]);
    expect(
      resolveEmissionFactor(orphan, normalized, { applicableYear: APPLICABLE_YEAR }),
    ).toBeNull();
  });

  it('明示指定（emissionFactorId = ideaFactorId）でのみ解決される', () => {
    const normalized = normalizeIdeaFactor(ideaFactor(), APPLICABLE_YEAR);
    const record = scope3Record({ emissionFactorId: 'idea-fac-1' });
    expect(
      resolveEmissionFactor(record, [normalized], { applicableYear: APPLICABLE_YEAR }),
    ).toBe(normalized);
  });

  it('Scope1/2 の自動解決に影響しない（既存係数と混在しても候補に現れない回帰）', () => {
    const electricityFactor: EmissionFactorRow = {
      id: 'fac-elec',
      organizationId: null,
      name: '電気（全国）',
      energyType: 'electricity',
      scope: 'scope2',
      factorValue: 0.000438,
      unit: 't-CO2e/kWh',
      applicableYear: APPLICABLE_YEAR,
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
    };
    const scope12Record: ActivityRecordRow = {
      id: 'act-elec-1',
      organizationId: 'org-1',
      locationId: 'loc-1',
      energyType: 'electricity',
      amount: 1000,
      unit: 'kWh',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      isCalculated: false,
    };
    const normalizedIdea = normalizeIdeaFactor(ideaFactor(), APPLICABLE_YEAR);

    const withoutIdea = computeEmissions([scope12Record], [electricityFactor], {
      resolveContext: () => ({ applicableYear: APPLICABLE_YEAR }),
    });
    const withIdea = computeEmissions([scope12Record], [electricityFactor, normalizedIdea], {
      resolveContext: () => ({ applicableYear: APPLICABLE_YEAR }),
    });
    // Scope1/2 のみの組織（IDEA 係数が混ざっても）結果は不変
    expect(withIdea).toEqual(withoutIdea);
    expect(withIdea.results).toHaveLength(1);
    expect(withIdea.results[0].emissionFactorId).toBe('fac-elec');
  });
});

describe('toScope3Insert', () => {
  const baseResult: EmissionResultInsert = {
    activityRecordId: 'act-s3-1',
    emissionFactorId: 'idea-fac-1', // 純粋コアが返す正規化行の id（= ideaFactorId）
    locationId: 'loc-1',
    scope: 'scope3',
    categoryId: null,
    emissions: 0.090351,
  };

  it('§4.3-4 のとおり FK を詰め替える（emissionFactorId=null / ideaFactorId セット）', () => {
    const insert = toScope3Insert(baseResult, ideaFactor(), ideaImport(), scope3Record());

    expect(insert.emissionFactorId).toBeNull();
    expect(insert.ideaFactorId).toBe('idea-fac-1');
    expect(insert.categoryId).toBe(1);
    expect(insert.appliedFactorValue).toBe(0.0903508069);
    expect(insert.appliedFactorUnit).toBe('kg-CO2e/kg');
    expect(insert.appliedFactorName).toBe('999999999mJPN ダミー製品 (AIST-IDEA Ver.4.0 標準版)');
    // 算定済みの値は変えない
    expect(insert.emissions).toBe(0.090351);
    expect(insert.scope).toBe('scope3');
  });

  it('categoryId は record.scope3CategoryId から供給される（未設定は null）', () => {
    const insert = toScope3Insert(
      baseResult,
      ideaFactor(),
      ideaImport(),
      scope3Record({ scope3CategoryId: undefined }),
    );
    expect(insert.categoryId).toBeNull();
  });

  it('appliedFactorName が最大長（ideaCode 30 + productName 300 + version 100）でも切れない', () => {
    const longFactor = ideaFactor({
      ideaCode: 'C'.repeat(30),
      productName: 'あ'.repeat(300),
    });
    const longImport = ideaImport({ version: 'V'.repeat(100) });
    const insert = toScope3Insert(baseResult, longFactor, longImport, scope3Record());

    const expected = `${'C'.repeat(30)} ${'あ'.repeat(300)} (AIST-IDEA ${'V'.repeat(100)})`;
    expect(insert.appliedFactorName).toBe(expected);
    // 生成規則の最大長 30+1+300+12+100+1 = 444（§3.3）。emission_results."appliedFactorName" は
    // varchar(500) のため value too long による全件ロールバックは起きない。
    expect(insert.appliedFactorName).toHaveLength(444);
    expect((insert.appliedFactorName ?? '').length).toBeLessThanOrEqual(500);
  });
});

describe('computeScope3Emissions', () => {
  it('明示解決パスで算定し、FK 詰め替え済みの結果を返す', () => {
    const { results, unresolved } = computeScope3Emissions(
      [scope3Record()],
      [ideaFactor()],
      [ideaImport()],
      APPLICABLE_YEAR,
    );

    expect(unresolved).toEqual([]);
    expect(results).toHaveLength(1);
    // 1000 kg × 0.0903508069 kg-CO2e/kg = 90.3508069 kg-CO2e = 0.0903508069 t → 第6位丸め
    expect(results[0]).toEqual({
      activityRecordId: 'act-s3-1',
      emissionFactorId: null,
      ideaFactorId: 'idea-fac-1',
      locationId: 'loc-1',
      scope: 'scope3',
      categoryId: 1,
      emissions: 0.090351,
      appliedFactorValue: 0.0903508069,
      appliedFactorUnit: 'kg-CO2e/kg',
      appliedFactorName: '999999999mJPN ダミー製品 (AIST-IDEA Ver.4.0 標準版)',
    });
  });

  it('categoryId が入力カテゴリのまま伝播する（§4.3-1 の select 欠落回帰）', () => {
    const { results } = computeScope3Emissions(
      [scope3Record({ scope3CategoryId: 7 })],
      [ideaFactor()],
      [ideaImport()],
      APPLICABLE_YEAR,
    );
    expect(results[0].categoryId).toBe(7);
  });

  it('円単位原単位（1e-9 t/円オーダー）でも桁落ちしない', () => {
    // 10,000,000 円 × 1.23456789e-9 t-CO2e/円 = 0.0123456789 t → 第6位丸めで 0.012346
    const { results, unresolved } = computeScope3Emissions(
      [scope3Record({ amount: 10_000_000, unit: '円' })],
      [ideaFactor({ gwpValue: '0.00000123456789', unit: '円' })],
      [ideaImport()],
      APPLICABLE_YEAR,
    );
    expect(unresolved).toEqual([]);
    expect(results[0].emissions).toBe(0.012346);
    // スナップショットは丸めない（原典精度の係数値を保持）
    expect(results[0].appliedFactorValue).toBe(1.23456789e-6);
  });

  it('孤児（ideaFactorId=null）は SCOPE3_FACTOR_MISSING になり、他の IDEA 係数へ誤マッチしない', () => {
    const orphan = scope3Record({ id: 'act-orphan', ideaFactorId: null });
    const { results, unresolved } = computeScope3Emissions(
      [orphan],
      // 他製品の IDEA 係数が存在しても自動マッチしないこと（§6 の回帰）
      [ideaFactor(), ideaFactor({ id: 'idea-fac-2', ideaCode: '022200000mJPN' })],
      [ideaImport()],
      APPLICABLE_YEAR,
    );

    expect(results).toEqual([]);
    expect(unresolved).toEqual([
      {
        activityRecordId: 'act-orphan',
        locationId: 'loc-1',
        energyType: 'scope3_activity',
        reason: 'SCOPE3_FACTOR_MISSING',
        detail: SCOPE3_FACTOR_MISSING_MESSAGE,
      },
    ]);
  });

  it('参照先の係数が取得結果に無い場合も SCOPE3_FACTOR_MISSING とする（多層防御）', () => {
    const { results, unresolved } = computeScope3Emissions(
      [scope3Record({ ideaFactorId: 'idea-fac-deleted' })],
      [ideaFactor()],
      [ideaImport()],
      APPLICABLE_YEAR,
    );
    expect(results).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].reason).toBe('SCOPE3_FACTOR_MISSING');
  });

  it('活動量と製品の単位が食い違う場合は UNIT_MISMATCH（純粋コアの検証を引き継ぐ）', () => {
    const { results, unresolved } = computeScope3Emissions(
      [scope3Record({ unit: 'kWh' })],
      [ideaFactor({ unit: 'kg' })],
      [ideaImport()],
      APPLICABLE_YEAR,
    );
    expect(results).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].reason).toBe('UNIT_MISMATCH');
  });

  it('Scope3 レコードが無ければ何も生成しない（Scope1/2 のみの組織で結果不変の回帰）', () => {
    expect(computeScope3Emissions([], [], [], APPLICABLE_YEAR)).toEqual({
      results: [],
      unresolved: [],
      warnings: [],
    });
  });
});
