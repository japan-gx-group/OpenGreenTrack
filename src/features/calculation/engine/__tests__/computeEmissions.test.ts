import { describe, expect, it } from 'vitest';
import type { ActivityRecordRow, EmissionFactorRow } from '../../types';
import { computeEmissions, roundEmissions } from '../computeEmissions';
import { isScope3EnergyType, scope3CategoryIdForEnergyType } from '../scope3Category';

const record = (overrides: Partial<ActivityRecordRow> = {}): ActivityRecordRow => ({
  id: 'act-1',
  organizationId: 'org-1',
  locationId: 'loc-1',
  energyType: 'electricity',
  amount: 1000,
  unit: 'kWh',
  periodStart: '2024-05-01',
  periodEnd: '2024-05-31',
  isCalculated: false,
  ...overrides,
});

const factor = (overrides: Partial<EmissionFactorRow> = {}): EmissionFactorRow => ({
  id: 'fac-1',
  organizationId: 'org-1',
  name: '電気（調整後排出係数）',
  energyType: 'electricity',
  scope: 'scope2',
  factorValue: 0.000438,
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

describe('roundEmissions', () => {
  // numeric(15,6) への拡張に合わせて第3位丸めから変更（表示丸めは第3位のまま）。
  it('小数第6位に丸める', () => {
    expect(roundEmissions(0.1234565)).toBe(0.123457);
    expect(roundEmissions(0.1234564)).toBe(0.123456);
  });

  it('第3位で丸め切れている値は不変', () => {
    expect(roundEmissions(0.438)).toBe(0.438);
    expect(roundEmissions(122.89)).toBe(122.89);
  });

  it('0.5kg未満の小口明細がゼロ落ちしない（1g 粒度）', () => {
    // 第3位丸め（1kg 粒度）だと 0.0004 t = 0.4kg が 0 に落ちるため、第6位（1g 粒度）で保持する
    expect(roundEmissions(0.0004)).toBe(0.0004);
    expect(roundEmissions(0.000001)).toBe(0.000001);
    // 1g 未満は丸めで落ちる（保存粒度の下限）
    expect(roundEmissions(0.0000004)).toBe(0);
  });
});

describe('computeEmissions 明示指定の警告', () => {
  const provider2025 = factor({
    id: 'provider-2025',
    applicableYear: 2025,
    name: '東京電力EP メニューA（2025年度）',
    providerName: '東京電力エナジーパートナー(株)',
    providerNumber: 'A0002',
    menuName: 'メニューA',
    factorType: 'adjusted',
  });
  const rec2026 = record({
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
    emissionFactorId: 'provider-2025',
  });
  const context = { resolveContext: () => ({ applicableYear: 2026 }) };

  it('同一事業者の当年度行へ読み替えたら警告に載せる（算定は読み替え先で成立する）', () => {
    const provider2026 = factor({
      ...provider2025,
      id: 'provider-2026',
      applicableYear: 2026,
      name: '東京電力EP メニューA（2026年度）',
    });
    const { results, unresolved, warnings } = computeEmissions(
      [rec2026],
      [provider2025, provider2026, factor({ id: 'official-2026', applicableYear: 2026 })],
      context,
    );
    expect(unresolved).toHaveLength(0);
    expect(results[0]?.emissionFactorId).toBe('provider-2026');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      activityRecordId: 'act-1',
      locationId: 'loc-1',
      energyType: 'electricity',
      reason: 'EXPLICIT_FACTOR_REMAPPED',
      requestedFactorId: 'provider-2025',
      appliedFactorId: 'provider-2026',
    });
    expect(warnings[0].detail).toContain('東京電力EP メニューA（2026年度）');
  });

  it('自動解決へフォールバックしたら警告に載せる（算定自体は成立させる）', () => {
    const { results, unresolved, warnings } = computeEmissions(
      [rec2026],
      [provider2025, factor({ id: 'official-2026', applicableYear: 2026 })],
      context,
    );
    expect(unresolved).toHaveLength(0);
    expect(results[0]?.emissionFactorId).toBe('official-2026');
    expect(warnings[0]).toMatchObject({
      reason: 'EXPLICIT_FACTOR_FALLBACK',
      requestedFactorId: 'provider-2025',
      appliedFactorId: 'official-2026',
    });
  });

  it('指定どおりに使えた場合・明示指定が無い場合は警告を出さない', () => {
    expect(computeEmissions([record({ emissionFactorId: 'fac-1' })], [factor()]).warnings).toHaveLength(0);
    expect(computeEmissions([record()], [factor()]).warnings).toHaveLength(0);
  });

  it('未算定（係数なし・単位不一致）のレコードは警告ではなく unresolved に載せる', () => {
    expect(computeEmissions([rec2026], [], context)).toMatchObject({ unresolved: [{ reason: 'FACTOR_NOT_FOUND' }], warnings: [] });
    const { unresolved, warnings } = computeEmissions(
      [{ ...rec2026, unit: 'm3' }],
      [provider2025, factor({ id: 'official-2026', applicableYear: 2026 })],
      context,
    );
    expect(unresolved[0]).toMatchObject({ reason: 'UNIT_MISMATCH' });
    expect(warnings).toHaveLength(0);
  });
});

describe('computeEmissions 適用係数のスナップショット', () => {
  it('適用係数の値・単位・名称を結果に焼き付ける', () => {
    // 係数マスタは公式係数 seed の再投入・カスタム係数の編集で上書きされ、削除時は FK が null になる。
    // 算定時点の根拠を結果行だけで再現できることを担保する。
    const { results } = computeEmissions([record()], [factor({ name: '電気 (株)エネット メニューC（基礎）' })]);
    expect(results[0]).toMatchObject({
      appliedFactorValue: 0.000438,
      appliedFactorUnit: 't-CO2e/kWh',
      appliedFactorName: '電気 (株)エネット メニューC（基礎）',
    });
  });

  it('スナップショットは換算前の係数値そのもの（単位換算を織り込まない）', () => {
    // 1MWh を kWh 係数で算定しても、焼き付けるのは係数マスタの値と単位。
    const { results } = computeEmissions([record({ amount: 1, unit: 'MWh' })], [factor()]);
    expect(results[0]).toMatchObject({ emissions: 0.438, appliedFactorValue: 0.000438, appliedFactorUnit: 't-CO2e/kWh' });
  });
});

describe('computeEmissions', () => {
  it('排出量 = 活動量 × 排出係数 を計算する（電気1000kWh × 0.000438 = 0.438）', () => {
    const { results, unresolved } = computeEmissions([record()], [factor()]);
    expect(unresolved).toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      activityRecordId: 'act-1',
      emissionFactorId: 'fac-1',
      locationId: 'loc-1',
      scope: 'scope2',
      categoryId: null,
      emissions: 0.438,
    });
  });

  it('単位換算を伴う場合も正しく計算する（1MWh = 1000kWh → 0.438）', () => {
    const { results } = computeEmissions(
      [record({ amount: 1, unit: 'MWh' })],
      [factor()],
    );
    expect(results[0].emissions).toBe(0.438);
  });

  it('適合する係数が無いレコードは unresolved(FACTOR_NOT_FOUND) に積まれる', () => {
    const { results, unresolved } = computeEmissions([record()], []);
    expect(results).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({
      activityRecordId: 'act-1',
      reason: 'FACTOR_NOT_FOUND',
    });
  });

  it('単位が換算不能なレコードは unresolved(UNIT_MISMATCH) に積まれる', () => {
    const { results, unresolved } = computeEmissions(
      [record({ unit: 'm3' })],
      [factor()],
    );
    expect(results).toHaveLength(0);
    expect(unresolved[0]).toMatchObject({ reason: 'UNIT_MISMATCH' });
  });

  it('同順位に換算不能な係数が先に並んでいても、換算可能な係数で算定する', () => {
    // energyType='fuel' の公式係数は tCO2/t・tCO2/千m3・tCO2/kL が同じ優先度に混在し、id 順で先頭が決まる。
    const perTonne = factor({ id: 'fuel-a', name: '燃料 灯油', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/t', factorValue: 3 });
    const perKl = factor({ id: 'fuel-b', name: '燃料 灯油', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/kL', factorValue: 2.49 });
    const { results, unresolved } = computeEmissions(
      [record({ energyType: 'fuel', unit: 'L', amount: 1000 })],
      [perTonne, perKl],
    );
    expect(unresolved).toHaveLength(0);
    expect(results[0]).toMatchObject({ emissionFactorId: 'fuel-b', emissions: roundEmissions(1000 * 0.001 * 2.49) });
  });

  it('同順位の係数がどれも換算不能なら UNIT_MISMATCH（detail に弾いた係数の単位を列挙する）', () => {
    const perTonne = factor({ id: 'fuel-a', name: '燃料 原料炭', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/t' });
    const perThousandM3 = factor({ id: 'fuel-b', name: '燃料 天然ガス', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/千m3' });
    const { results, unresolved } = computeEmissions(
      [record({ energyType: 'fuel', unit: 'L' })],
      [perTonne, perThousandM3],
    );
    expect(results).toHaveLength(0);
    expect(unresolved[0]).toMatchObject({ reason: 'UNIT_MISMATCH' });
    expect(unresolved[0].detail).toContain('「L」');
    expect(unresolved[0].detail).toContain('tCO2/t / tCO2/千m3');
  });

  it('活動量の単位が空文字のレコードは（単位なし扱いにせず）UNIT_MISMATCH になる', () => {
    // DB は unit NOT NULL だが空文字の CHECK は無い。空文字はどの係数にも換算できないため、
    // 単位互換の絞り込みをスキップしても結果は変わらず、未算定として正しく報告する。
    const { results, unresolved } = computeEmissions([record({ unit: '' })], [factor()]);
    expect(results).toHaveLength(0);
    expect(unresolved[0]).toMatchObject({ reason: 'UNIT_MISMATCH' });
    expect(unresolved[0].detail).toContain('t-CO2e/kWh');
  });

  it('明示指定した係数が換算不能なら、他に換算可能な候補があっても UNIT_MISMATCH（黙って差し替えない）', () => {
    const perTonne = factor({ id: 'fuel-a', name: '燃料 灯油', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/t' });
    const perKl = factor({ id: 'fuel-b', name: '燃料 灯油', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/kL' });
    const { results, unresolved } = computeEmissions(
      [record({ energyType: 'fuel', unit: 'L', emissionFactorId: 'fuel-a' })],
      [perTonne, perKl],
    );
    expect(results).toHaveLength(0);
    expect(unresolved[0]).toMatchObject({ reason: 'UNIT_MISMATCH' });
    expect(unresolved[0].detail).toContain('「tCO2/t」');
  });

  it('複数レコードで results と unresolved が混在しても正しく振り分ける', () => {
    const { results, unresolved } = computeEmissions(
      [
        record({ id: 'ok' }),
        record({ id: 'ng', energyType: 'water' }),
      ],
      [factor()],
    );
    expect(results.map((r) => r.activityRecordId)).toEqual(['ok']);
    expect(unresolved.map((u) => u.activityRecordId)).toEqual(['ng']);
  });

  it('輸送係数(t-CO2e/tkm)を tkm 活動量に適用して Scope3 排出量を算定する', () => {
    const { results, unresolved } = computeEmissions(
      [record({ energyType: 'freight_transport', amount: 10000, unit: 'tkm' })],
      [factor({
        id: 'freight-1',
        name: '物流委託（トンキロ法）',
        energyType: 'freight_transport',
        scope: 'scope3',
        factorValue: 0.000089,
        unit: 't-CO2e/tkm',
      })],
    );
    expect(unresolved).toHaveLength(0);
    expect(results[0]).toMatchObject({
      emissionFactorId: 'freight-1',
      scope: 'scope3',
      emissions: roundEmissions(10000 * 0.000089),
    });
  });

  it('resolveContext で地域名を注入すると地域係数が選ばれる', () => {
    const factors = [
      factor({ id: 'national', regionName: '全国', factorValue: 0.0005 }),
      factor({ id: 'region', regionName: '東京電力管内', factorValue: 0.000438 }),
    ];
    const { results } = computeEmissions([record()], factors, {
      resolveContext: () => ({ applicableYear: 2024, regionName: '東京電力管内' }),
    });
    expect(results[0].emissionFactorId).toBe('region');
  });

  it('同順位の標準係数が複数あり明示指定の無いレコードは unresolved(FACTOR_AMBIGUOUS) に積まれる', () => {
    const heavyA = factor({ id: 'heavy-a', name: '燃料 A重油', energyType: 'fuel_heavy_oil', scope: 'scope1', unit: 'tCO2/kL' });
    const heavyBC = factor({ id: 'heavy-bc', name: '燃料 B・C重油', energyType: 'fuel_heavy_oil', scope: 'scope1', unit: 'tCO2/kL' });
    const { results, unresolved } = computeEmissions(
      [record({ energyType: 'fuel_heavy_oil', unit: 'L' })],
      [heavyA, heavyBC],
    );
    expect(results).toHaveLength(0);
    expect(unresolved[0]).toMatchObject({ reason: 'FACTOR_AMBIGUOUS' });
    expect(unresolved[0].detail).toContain('A重油');
    expect(unresolved[0].detail).toContain('B・C重油');

    // 明示指定があれば通常どおり算定する
    const explicit = computeEmissions(
      [record({ energyType: 'fuel_heavy_oil', unit: 'L', amount: 1000, emissionFactorId: 'heavy-bc' })],
      [heavyA, heavyBC],
    );
    expect(explicit.unresolved).toHaveLength(0);
    expect(explicit.results[0]).toMatchObject({ emissionFactorId: 'heavy-bc', emissions: roundEmissions(1 * 0.000438) });
  });

  it('廃棄物の scope3 標準係数で算定すると scope=scope3・categoryId=5 の結果になる（集計対象の形）', () => {
    const waste = factor({
      id: 'waste-avg',
      name: '廃棄物焼却 平均値',
      energyType: 'waste',
      scope: 'scope3',
      factorValue: 0.533928,
      unit: 't-CO2/t',
      organizationId: null,
    });
    const { results, unresolved } = computeEmissions(
      [record({ energyType: 'waste', unit: 't', amount: 10, emissionFactorId: 'waste-avg' })],
      [waste],
    );
    expect(unresolved).toHaveLength(0);
    expect(results[0]).toEqual({
      activityRecordId: 'act-1',
      emissionFactorId: 'waste-avg',
      locationId: 'loc-1',
      scope: 'scope3',
      categoryId: 5,
      emissions: 5.33928,
      appliedFactorValue: 0.533928,
      appliedFactorUnit: 't-CO2/t',
      appliedFactorName: '廃棄物焼却 平均値',
    });
  });

  it('Scope1/2 の係数では categoryId は null のまま', () => {
    const { results } = computeEmissions([record()], [factor()]);
    expect(results[0].categoryId).toBeNull();
  });

  it('水道の scope3 カスタム係数は categoryId=1 で算定される（どの集計にも載らない結果を作らない）', () => {
    const water = factor({
      id: 'water-custom',
      name: '上水道（自社設定）',
      energyType: 'water',
      scope: 'scope3',
      factorValue: 0.00019,
      unit: 't-CO2e/m3',
      isCustom: true,
    });
    const { results, unresolved } = computeEmissions(
      [record({ energyType: 'water', unit: 'm3', amount: 100 })],
      [water],
    );
    expect(unresolved).toHaveLength(0);
    expect(results[0]).toMatchObject({ scope: 'scope3', categoryId: 1, emissions: 0.019 });
  });

  it('種別と食い違う Scope の係数は未算定にする（Scope3 の種別 × scope1 係数）', () => {
    // 算定すると排出量は Scope1 の表に載るのに、データ充足状況は energyType から Scope3 と
    // 判定して「採用されない」件数に入れる。二重基準を作らず未算定に留める。
    const wrong = factor({
      id: 'waste-scope1',
      name: '廃棄物（自社設定）',
      energyType: 'waste',
      scope: 'scope1',
      factorValue: 0.5,
      unit: 't-CO2/t',
      isCustom: true,
    });
    const { results, unresolved } = computeEmissions(
      [record({ energyType: 'waste', unit: 't', amount: 10 })],
      [wrong],
    );
    expect(results).toHaveLength(0);
    expect(unresolved[0]).toMatchObject({ reason: 'FACTOR_SCOPE_MISMATCH', energyType: 'waste' });
    expect(unresolved[0].detail).toContain('scope1');
  });

  it('種別と食い違う Scope の係数は未算定にする（Scope1・2 の種別 × scope3 係数）', () => {
    // categoryId が決まらず、算定しても排出量がどの集計にも載らないまま「算定済み」と数えられる。
    const wrong = factor({ id: 'elec-scope3', scope: 'scope3', isCustom: true });
    const { results, unresolved } = computeEmissions([record()], [wrong]);
    expect(results).toHaveLength(0);
    expect(unresolved[0]).toMatchObject({ reason: 'FACTOR_SCOPE_MISMATCH', energyType: 'electricity' });
  });
});

describe('scope3CategoryIdForEnergyType', () => {
  it('排出係数マスタで算定する Scope3 カテゴリを energyType から引く', () => {
    expect(scope3CategoryIdForEnergyType('waste')).toBe(5);
    expect(scope3CategoryIdForEnergyType('freight_transport')).toBe(4);
    expect(scope3CategoryIdForEnergyType('logistics')).toBe(4);
    expect(scope3CategoryIdForEnergyType('business_travel')).toBe(6);
    expect(scope3CategoryIdForEnergyType('business_travel_commuting')).toBe(7);
    expect(scope3CategoryIdForEnergyType('purchased_goods_services')).toBe(1);
    expect(scope3CategoryIdForEnergyType('supplier_data')).toBe(1);
  });

  it('Scope1/2 の種別・車両・IDEA 積上げは null', () => {
    expect(scope3CategoryIdForEnergyType('electricity')).toBeNull();
    expect(scope3CategoryIdForEnergyType('vehicle')).toBeNull();
    expect(scope3CategoryIdForEnergyType('scope3_activity')).toBeNull();
  });
});

describe('isScope3EnergyType', () => {
  it('標準係数で算定する Scope3 種別と IDEA 積上げの両方を Scope3 と判定する', () => {
    // 廃棄物・出張・通勤は手動入力の現役カテゴリで、算定されると Scope 3 に載る。
    expect(isScope3EnergyType('waste')).toBe(true);
    expect(isScope3EnergyType('business_travel')).toBe(true);
    expect(isScope3EnergyType('business_travel_commuting')).toBe(true);
    expect(isScope3EnergyType('freight_transport')).toBe(true);
    expect(isScope3EnergyType('logistics')).toBe(true);
    expect(isScope3EnergyType('purchased_goods_services')).toBe(true);
    expect(isScope3EnergyType('supplier_data')).toBe(true);
    // 水道は公式係数が無く自社設定の係数で算定するが、カテゴリ1 の Scope3 として数える
    expect(isScope3EnergyType('water')).toBe(true);
    expect(isScope3EnergyType('scope3_activity')).toBe(true);
  });

  it('Scope1/2 の種別は false', () => {
    expect(isScope3EnergyType('electricity')).toBe(false);
    expect(isScope3EnergyType('city_gas')).toBe(false);
    expect(isScope3EnergyType('fuel')).toBe(false);
    expect(isScope3EnergyType('heat')).toBe(false);
    expect(isScope3EnergyType('vehicle')).toBe(false);
  });

  it('未知の種別は false（Object.prototype 由来の名前も拾わない）', () => {
    expect(isScope3EnergyType('unknown_type')).toBe(false);
    expect(isScope3EnergyType('constructor')).toBe(false);
    expect(isScope3EnergyType('toString')).toBe(false);
  });
});
