import { describe, expect, it } from 'vitest';
import type { ActivityRecordRow, EmissionFactorRow } from '../../types';
import {
  applicableYearsForFiscalYear,
  applicableYearsForRecord,
  deriveApplicableYear,
  filterApplicableFactors,
  isAmbiguousChoice,
  isProvisionalFactor,
  isSupersededProvisionalFactor,
  listFactorCandidates,
  PROVISIONAL_FALLBACK_YEARS,
  resolveEmissionFactor,
  resolveEmissionFactorDetailed,
  withProvisionalYears,
} from '../resolveEmissionFactor';

const ORG = 'org-1';
const LOC = 'loc-1';

const record = (overrides: Partial<ActivityRecordRow> = {}): ActivityRecordRow => ({
  id: 'act-1',
  organizationId: ORG,
  locationId: LOC,
  energyType: 'electricity',
  amount: 1000,
  unit: 'kWh',
  periodStart: '2024-05-01',
  periodEnd: '2024-05-31',
  isCalculated: false,
  ...overrides,
});

const factor = (overrides: Partial<EmissionFactorRow> = {}): EmissionFactorRow => ({
  id: 'fac-std-national',
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

const context = { applicableYear: 2024, regionName: '東京電力管内' };

describe('deriveApplicableYear', () => {
  it('4月以降はその年の年度', () => {
    expect(deriveApplicableYear('2024-05-01')).toBe(2024);
    expect(deriveApplicableYear('2024-04-01')).toBe(2024);
  });

  it('1〜3月は前年の年度', () => {
    expect(deriveApplicableYear('2024-03-31')).toBe(2023);
    expect(deriveApplicableYear('2024-01-15')).toBe(2023);
  });
});

describe('resolveEmissionFactor 優先順位', () => {
  it('拠点固有カスタム(1) が地域標準(4)・全国標準(5) より優先される', () => {
    const factors = [
      factor({ id: 'national', regionName: '全国' }),
      factor({ id: 'region', regionName: '東京電力管内' }),
      factor({ id: 'loc-custom', isCustom: true, locationId: LOC, regionName: '拠点' }),
    ];
    expect(resolveEmissionFactor(record(), factors, context)?.id).toBe('loc-custom');
  });

  it('組織全体カスタム(3) が標準係数(4/5) より優先される', () => {
    const factors = [
      factor({ id: 'region', regionName: '東京電力管内' }),
      factor({ id: 'org-custom', isCustom: true, locationId: null, supplierId: null }),
    ];
    expect(resolveEmissionFactor(record(), factors, context)?.id).toBe('org-custom');
  });

  it('地域一致の標準(4) が全国標準(5) より優先される', () => {
    const factors = [
      factor({ id: 'national', regionName: '全国' }),
      factor({ id: 'region', regionName: '東京電力管内' }),
    ];
    expect(resolveEmissionFactor(record(), factors, context)?.id).toBe('region');
  });

  it('regionName コンテキスト未指定なら地域標準(4)はスキップし全国標準(5)に落ちる', () => {
    const factors = [
      factor({ id: 'national', regionName: '全国' }),
      factor({ id: 'region', regionName: '東京電力管内' }),
    ];
    const resolved = resolveEmissionFactor(record(), factors, { applicableYear: 2024 });
    expect(resolved?.id).toBe('national');
  });

  it('サプライヤー固有カスタム係数(tier2)は活動量レコードにマッチせず、標準係数が選ばれる', () => {
    // Phase1: 活動量に supplier 紐付けが無いため、supplierId を持つ係数は誤適用してはならない
    const factors = [
      factor({ id: 'supplier-custom', isCustom: true, supplierId: 'sup-1', locationId: null, factorValue: 9.9 }),
      factor({ id: 'national', regionName: '全国' }),
    ];
    expect(resolveEmissionFactor(record(), factors, context)?.id).toBe('national');
  });

  it('同一優先度では factorType=adjusted（調整後排出係数）を優先する（タイブレーク）', () => {
    const factors = [
      factor({ id: 'basic', name: '電気（基礎排出係数）', regionName: '東京電力管内', factorType: 'basic' }),
      factor({ id: 'adjusted', name: '電気（調整後排出係数）', regionName: '東京電力管内', factorType: 'adjusted' }),
    ];
    expect(resolveEmissionFactor(record(), factors, context)?.id).toBe('adjusted');
  });

  it('事業者別係数（providerName あり）は自動解決の候補にならない', () => {
    const factors = [
      factor({
        id: 'provider',
        providerName: '東京電力エナジーパートナー株式会社',
        providerNumber: 'A0269',
        menuName: 'メニューM(残差)',
        factorType: 'adjusted',
        regionName: '全国',
      }),
      factor({ id: 'national', regionName: '全国' }),
    ];
    expect(resolveEmissionFactor(record(), factors, context)?.id).toBe('national');
    expect(listFactorCandidates(record(), factors, context).map((f) => f.id)).toEqual(['national']);
  });
});

describe('listFactorCandidates 候補一覧', () => {
  it('優先度順（拠点カスタム→組織カスタム→地域標準→全国標準）に並べて返す', () => {
    const factors = [
      factor({ id: 'national', regionName: '全国' }),
      factor({ id: 'region', regionName: '東京電力管内' }),
      factor({ id: 'org-custom', isCustom: true, locationId: null, supplierId: null }),
      factor({ id: 'loc-custom', isCustom: true, locationId: LOC, regionName: '拠点' }),
    ];
    expect(listFactorCandidates(record(), factors, context).map((f) => f.id)).toEqual([
      'loc-custom',
      'org-custom',
      'region',
      'national',
    ]);
  });

  it('同一優先度では factorType=adjusted を先頭に、その後は id 昇順で並ぶ', () => {
    const factors = [
      factor({ id: 'b-basic', name: '電気（基礎）', regionName: '東京電力管内', factorType: 'basic' }),
      factor({ id: 'a-basic', name: '電気（基礎2）', regionName: '東京電力管内', factorType: 'basic' }),
      factor({ id: 'z-adjusted', name: '電気（調整後）', regionName: '東京電力管内', factorType: 'adjusted' }),
    ];
    expect(listFactorCandidates(record(), factors, context).map((f) => f.id)).toEqual([
      'z-adjusted',
      'a-basic',
      'b-basic',
    ]);
  });

  it('前提フィルタ外（年度不一致・非active・種別不一致）やどの段階にも該当しない係数は含めない', () => {
    const factors = [
      factor({ id: 'other-year', applicableYear: 2023 }),
      factor({ id: 'draft', status: 'draft' }),
      factor({ id: 'gas', energyType: 'city_gas' }),
      // サプライヤー固有カスタムは Phase1 ではどのレコードにもマッチしない（tier Infinity）
      factor({ id: 'supplier', isCustom: true, supplierId: 'sup-1', locationId: null }),
      factor({ id: 'national', regionName: '全国' }),
    ];
    expect(listFactorCandidates(record(), factors, context).map((f) => f.id)).toEqual(['national']);
  });

  it('先頭の候補は resolveEmissionFactor の自動解決結果と一致する', () => {
    const factors = [
      factor({ id: 'national', regionName: '全国' }),
      factor({ id: 'region', regionName: '東京電力管内' }),
    ];
    const candidates = listFactorCandidates(record(), factors, context);
    expect(candidates[0]?.id).toBe(resolveEmissionFactor(record(), factors, context)?.id);
  });
});

describe('resolveEmissionFactor 明示指定（emissionFactorId）', () => {
  it('明示指定された係数が候補内にあれば、優先順位より優先して使う', () => {
    const factors = [
      factor({ id: 'loc-custom', isCustom: true, locationId: LOC, regionName: '拠点' }),
      factor({ id: 'national', regionName: '全国' }),
    ];
    // 自動解決なら loc-custom（tier1）だが、全国標準を明示指定した場合はそちらを使う
    const resolved = resolveEmissionFactor(
      record({ emissionFactorId: 'national' }),
      factors,
      context,
    );
    expect(resolved?.id).toBe('national');
  });

  it('明示指定なら事業者別係数（自動候補外）も使える', () => {
    const factors = [
      factor({
        id: 'provider',
        providerName: '東京電力エナジーパートナー株式会社',
        menuName: 'メニューM(残差)',
        factorType: 'adjusted',
        factorValue: 0.000452,
      }),
      factor({ id: 'national', regionName: '全国' }),
    ];
    const resolved = resolveEmissionFactor(
      record({ emissionFactorId: 'provider' }),
      factors,
      context,
    );
    expect(resolved?.id).toBe('provider');
  });

  it('明示指定が前提フィルタを満たさない（年度不一致等）場合は自動解決へフォールバックする', () => {
    const factors = [
      factor({ id: 'provider-old', providerName: '東京電力EP', applicableYear: 2023 }),
      factor({ id: 'national', regionName: '全国' }),
    ];
    const resolved = resolveEmissionFactor(
      record({ emissionFactorId: 'provider-old' }),
      factors,
      context,
    );
    expect(resolved?.id).toBe('national');
  });

  it('明示指定が候補内に無い（アーカイブ済み等）場合は自動解決へフォールバックする', () => {
    const factors = [
      factor({ id: 'archived', status: 'archived' }),
      factor({ id: 'national', regionName: '全国' }),
    ];
    const resolved = resolveEmissionFactor(
      record({ emissionFactorId: 'archived' }),
      factors,
      context,
    );
    expect(resolved?.id).toBe('national');
  });

  it('明示指定が null / 未指定なら従来どおり優先順位で解決する', () => {
    const factors = [
      factor({ id: 'loc-custom', isCustom: true, locationId: LOC, regionName: '拠点' }),
      factor({ id: 'national', regionName: '全国' }),
    ];
    expect(resolveEmissionFactor(record({ emissionFactorId: null }), factors, context)?.id).toBe(
      'loc-custom',
    );
  });
});

describe('明示指定の決まり方（kind）と事業者別係数の読み替え', () => {
  const tepco2023 = factor({
    id: 'tepco-2023',
    applicableYear: 2023,
    providerName: '東京電力エナジーパートナー(株)',
    providerNumber: 'A0002',
    menuName: 'メニューA',
    factorType: 'adjusted',
    effectiveFrom: '2023-04-01',
    effectiveTo: '2024-03-31',
  });
  const tepco2024 = factor({
    ...tepco2023,
    id: 'tepco-2024',
    applicableYear: 2024,
    effectiveFrom: '2024-04-01',
    effectiveTo: '2025-03-31',
  });
  const national2024 = factor({ id: 'national-2024', regionName: '全国' });

  it('指定どおりに使えたか・明示指定が無かったかを kind で返す（requestedFactorId は null）', () => {
    const factors = [tepco2024, national2024];
    expect(resolveEmissionFactorDetailed(record({ emissionFactorId: 'tepco-2024' }), factors, context)).toEqual({
      status: 'resolved',
      factor: tepco2024,
      kind: 'explicit',
      requestedFactorId: null,
    });
    expect(resolveEmissionFactorDetailed(record(), factors, context)).toEqual({
      status: 'resolved',
      factor: national2024,
      kind: 'auto',
      requestedFactorId: null,
    });
  });

  it('対象年度が公表されて過年度の事業者係数が外れたら、同一事業者・同一メニュー・同一係数種別の当年度行へ読み替える', () => {
    // 未公表の間に暫定適用で保存した 2023 年度の事業者係数。2024 年度が公表されると前提フィルタを外れる。
    const resolution = resolveEmissionFactorDetailed(
      record({ emissionFactorId: 'tepco-2023' }),
      [tepco2023, tepco2024, national2024],
      context,
    );
    expect(resolution).toEqual({
      status: 'resolved',
      factor: tepco2024,
      kind: 'explicit_remapped',
      requestedFactorId: 'tepco-2023',
    });
  });

  it('同一事業者の当年度行が無ければ自動解決へ落とし、explicit_fallback として指定 id を返す', () => {
    const resolution = resolveEmissionFactorDetailed(
      record({ emissionFactorId: 'tepco-2023' }),
      [tepco2023, national2024],
      context,
    );
    expect(resolution).toEqual({
      status: 'resolved',
      factor: national2024,
      kind: 'explicit_fallback',
      requestedFactorId: 'tepco-2023',
    });
  });

  it('指定 id が取得集合に無い（アーカイブ済み等）場合も explicit_fallback として通知する', () => {
    expect(
      resolveEmissionFactorDetailed(record({ emissionFactorId: 'missing' }), [national2024], context),
    ).toMatchObject({ status: 'resolved', factor: { id: 'national-2024' }, kind: 'explicit_fallback', requestedFactorId: 'missing' });
  });

  it('フォールバック先も無ければ not_found（警告ではなく未算定）', () => {
    // 2024 年度は別メニューの行で公表済み（暫定適用は解消）だが、読み替え先も自動解決の候補も無い。
    const menuB2024 = factor({ ...tepco2024, id: 'tepco-2024-b', menuName: 'メニューB' });
    expect(
      resolveEmissionFactorDetailed(record({ emissionFactorId: 'tepco-2023' }), [tepco2023, menuB2024], context),
    ).toEqual({ status: 'not_found' });
  });

  it('過年度の事業者係数でも、対象年度が未公表の間は暫定適用としてそのまま使う（読み替えない）', () => {
    expect(
      resolveEmissionFactorDetailed(record({ emissionFactorId: 'tepco-2023' }), [tepco2023], context),
    ).toEqual({ status: 'resolved', factor: tepco2023, kind: 'explicit', requestedFactorId: null });
  });

  it('登録番号が食い違う同名事業者へは読み替えない', () => {
    const other2024 = factor({ ...tepco2024, id: 'other-2024', providerNumber: 'A0099' });
    expect(
      resolveEmissionFactorDetailed(record({ emissionFactorId: 'tepco-2023' }), [tepco2023, other2024, national2024], context),
    ).toMatchObject({ factor: { id: 'national-2024' }, kind: 'explicit_fallback' });
  });

  it('メニュー・係数種別が違う行へは読み替えない', () => {
    const menuB = factor({ ...tepco2024, id: 'tepco-2024-b', menuName: 'メニューB' });
    const basic = factor({ ...tepco2024, id: 'tepco-2024-basic', factorType: 'basic' });
    expect(
      resolveEmissionFactorDetailed(record({ emissionFactorId: 'tepco-2023' }), [tepco2023, menuB, basic, national2024], context),
    ).toMatchObject({ factor: { id: 'national-2024' }, kind: 'explicit_fallback' });
  });

  it('読み替えは年度をまたぐ場合だけ。同一年度内の別行（有効期間外で外れた等）へは移さない', () => {
    // 同じ 2024 年度に同一事業者の行が 2 つあり、指定した方だけ有効期間外になった場面。
    const expired = factor({ ...tepco2024, id: 'tepco-2024-expired', effectiveTo: '2024-04-30' });
    expect(
      resolveEmissionFactorDetailed(record({ emissionFactorId: 'tepco-2024-expired' }), [expired, tepco2024, national2024], context),
    ).toMatchObject({ factor: { id: 'national-2024' }, kind: 'explicit_fallback' });
  });

  it('読み替え先が同一年度に複数あれば id 順で安定して選ぶ', () => {
    const dup = factor({ ...tepco2024, id: 'a-tepco-2024' });
    expect(
      resolveEmissionFactorDetailed(record({ emissionFactorId: 'tepco-2023' }), [tepco2024, tepco2023, dup, national2024], context),
    ).toMatchObject({ factor: { id: 'a-tepco-2024' }, kind: 'explicit_remapped' });
  });

  it('読み替え先が複数年度に残るときは、会計年度の開始年と一致する行を優先する（id 順より先）', () => {
    // 7月始まり FY2025（2025-07-01〜2026-06-30）の 2026-05。温対法年度は 2026 で会計年度の開始年 2025 と
    // 食い違い、前提フィルタは 2025 / 2026 の両方を通す。有効期間なしのカスタム事業者係数を年度ぶん
    // 登録していると読み替え先が 2 年度ぶん残り、id 昇順だけで採ると翌年度の行へ黙って移ってしまう。
    const julyContext = { applicableYear: 2025, regionName: '東京電力管内' };
    const crossingRecord = record({
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      emissionFactorId: 'custom-2024',
    });
    const custom2024 = factor({
      id: 'custom-2024',
      isCustom: true,
      applicableYear: 2024,
      providerName: '東京電力エナジーパートナー(株)',
      providerNumber: 'A0002',
      menuName: 'メニューA',
      factorType: 'adjusted',
    });
    // 会計年度の開始年と一致する行は id が後ろ（b-2025）、翌年度の行が id 先頭（a-2026）。
    const custom2025 = factor({ ...custom2024, id: 'b-2025', applicableYear: 2025 });
    const custom2026 = factor({ ...custom2024, id: 'a-2026', applicableYear: 2026 });

    expect(
      resolveEmissionFactorDetailed(crossingRecord, [custom2024, custom2026, custom2025], julyContext),
    ).toMatchObject({ factor: { id: 'b-2025' }, kind: 'explicit_remapped', requestedFactorId: 'custom-2024' });
  });

  it('事業者別でない係数（providerName なし）は読み替えの対象外', () => {
    const custom2023 = factor({ id: 'custom-2023', isCustom: true, locationId: LOC, applicableYear: 2023, regionName: '拠点' });
    const custom2024 = factor({ ...custom2023, id: 'custom-2024', applicableYear: 2024 });
    expect(
      resolveEmissionFactorDetailed(record({ emissionFactorId: 'custom-2023' }), [custom2023, custom2024, national2024], context),
    ).toMatchObject({ factor: { id: 'custom-2024' }, kind: 'explicit_fallback', requestedFactorId: 'custom-2023' });
  });
});

describe('resolveEmissionFactor 前提フィルタ', () => {
  it('applicableYear が対象年度より 2 年以上前の係数は除外される（暫定適用の範囲外）', () => {
    const factors = [factor({ applicableYear: 2022 })];
    expect(resolveEmissionFactor(record(), factors, context)).toBeNull();
  });

  it('対象年度の係数があれば、過年度の係数は候補にならない', () => {
    const current = factor({ id: 'fac-2024', applicableYear: 2024 });
    const past = factor({ id: 'fac-2023', applicableYear: 2023 });
    expect(resolveEmissionFactor(record(), [past, current], context)?.id).toBe('fac-2024');
  });

  it('status が active でない係数は除外される', () => {
    const factors = [factor({ status: 'draft' }), factor({ status: 'archived' })];
    expect(resolveEmissionFactor(record(), factors, context)).toBeNull();
  });

  it('energyType が一致しない係数は除外される', () => {
    const factors = [factor({ energyType: 'city_gas' })];
    expect(resolveEmissionFactor(record(), factors, context)).toBeNull();
  });

  it('有効期間外（effectiveFrom より前）の係数は除外される', () => {
    const factors = [factor({ effectiveFrom: '2024-06-01' })];
    expect(resolveEmissionFactor(record({ periodStart: '2024-05-01' }), factors, context)).toBeNull();
  });

  it('適合する係数が無ければ null を返す', () => {
    expect(resolveEmissionFactor(record(), [], context)).toBeNull();
  });
});

describe('applicableYearsForFiscalYear / applicableYearsForRecord', () => {
  it('4月始まりの会計年度は開始年 1 つ', () => {
    expect(applicableYearsForFiscalYear('2025-04-01', '2026-03-31')).toEqual([2025]);
    expect(applicableYearsForRecord('2025-05-01', 2025)).toEqual([2025]);
    expect(applicableYearsForRecord('2026-02-01', 2025)).toEqual([2025]);
  });

  it('7月始まりの会計年度は途中で温対法年度をまたぐため 2 年（昇順・重複なし）', () => {
    expect(applicableYearsForFiscalYear('2025-07-01', '2026-06-30')).toEqual([2025, 2026]);
    // またぐ前の月は開始年のみ、またいだ後の月は開始年＋翌年度
    expect(applicableYearsForRecord('2025-08-01', 2025)).toEqual([2025]);
    expect(applicableYearsForRecord('2026-04-01', 2025)).toEqual([2025, 2026]);
  });

  it('1月始まりの会計年度は前年の温対法年度も含む', () => {
    expect(applicableYearsForFiscalYear('2025-01-01', '2025-12-31')).toEqual([2024, 2025]);
    expect(applicableYearsForRecord('2025-02-01', 2025)).toEqual([2024, 2025]);
    expect(applicableYearsForRecord('2025-06-01', 2025)).toEqual([2025]);
  });
});

describe('非4月始まりの会計年度と公式係数（4月〜翌3月の有効期間）', () => {
  // 公式係数は generate.ts と同じく年度ごとに effectiveFrom/To を持つ
  const official = (year: number, overrides: Partial<EmissionFactorRow> = {}) =>
    factor({
      id: `official-${year}`,
      organizationId: null,
      applicableYear: year,
      effectiveFrom: `${year}-04-01`,
      effectiveTo: `${year + 1}-03-31`,
      ...overrides,
    });

  it('7月始まり FY2025 の 2026年4〜6月のレコードは翌年度（2026）の公式係数に解決する', () => {
    const factors = [official(2025), official(2026)];
    const resolved = resolveEmissionFactor(
      record({ periodStart: '2026-04-01', periodEnd: '2026-04-30' }),
      factors,
      { applicableYear: 2025 },
    );
    expect(resolved?.id).toBe('official-2026');
    // またぐ前の月は従来どおり開始年の公式係数
    expect(
      resolveEmissionFactor(record({ periodStart: '2025-08-01' }), factors, { applicableYear: 2025 })?.id,
    ).toBe('official-2025');
  });

  it('1月始まり FY2025 の 1〜3月のレコードは前年度（2024）の公式係数に解決する', () => {
    const factors = [official(2024), official(2025)];
    expect(
      resolveEmissionFactor(record({ periodStart: '2025-02-01' }), factors, { applicableYear: 2025 })?.id,
    ).toBe('official-2024');
    expect(
      resolveEmissionFactor(record({ periodStart: '2025-06-01' }), factors, { applicableYear: 2025 })?.id,
    ).toBe('official-2025');
  });

  it('4月始まりでは従来どおり開始年の公式係数だけが候補になる', () => {
    const factors = [official(2023), official(2024), official(2025)];
    expect(
      listFactorCandidates(record({ periodStart: '2024-05-01' }), factors, { applicableYear: 2024 }).map((f) => f.id),
    ).toEqual(['official-2024']);
    expect(
      listFactorCandidates(record({ periodStart: '2025-03-01' }), factors, { applicableYear: 2024 }).map((f) => f.id),
    ).toEqual(['official-2024']);
  });

  it('有効期間を持たないカスタム係数は会計年度の開始年で一致し、年度境界の月でも使われる', () => {
    const custom = factor({
      id: 'org-custom-2025',
      isCustom: true,
      locationId: null,
      supplierId: null,
      applicableYear: 2025,
    });
    const resolved = resolveEmissionFactor(
      record({ periodStart: '2026-04-01' }),
      [custom, official(2026)],
      { applicableYear: 2025 },
    );
    expect(resolved?.id).toBe('org-custom-2025');
  });

  it('年度ごとの有効期間なしカスタム係数が同時にヒットしたら会計年度の開始年側を優先する', () => {
    const custom = (year: number) =>
      factor({ id: `org-custom-${year}`, name: '自社電気', isCustom: true, locationId: null, supplierId: null, applicableYear: year });
    expect(
      listFactorCandidates(record({ periodStart: '2026-04-01' }), [custom(2026), custom(2025)], { applicableYear: 2025 }).map((f) => f.id),
    ).toEqual(['org-custom-2025', 'org-custom-2026']);
  });
});

describe('曖昧な候補（FACTOR_AMBIGUOUS）', () => {
  const heavyA = factor({ id: 'heavy-a', name: '燃料 A重油', energyType: 'fuel_heavy_oil', scope: 'scope1', unit: 'tCO2/kL' });
  const heavyBC = factor({ id: 'heavy-bc', name: '燃料 B・C重油', energyType: 'fuel_heavy_oil', scope: 'scope1', unit: 'tCO2/kL' });
  const heavyRecord = record({ energyType: 'fuel_heavy_oil', unit: 'L' });

  it('同順位で名称の異なる標準係数が複数あり明示指定が無ければ ambiguous', () => {
    const resolution = resolveEmissionFactorDetailed(heavyRecord, [heavyA, heavyBC], context);
    expect(resolution.status).toBe('ambiguous');
    expect(resolveEmissionFactor(heavyRecord, [heavyA, heavyBC], context)).toBeNull();
    expect(isAmbiguousChoice(listFactorCandidates(heavyRecord, [heavyA, heavyBC], context), heavyRecord, context)).toBe(true);
  });

  it('明示指定があればその係数に解決する', () => {
    expect(
      resolveEmissionFactor(record({ ...heavyRecord, emissionFactorId: 'heavy-bc' }), [heavyA, heavyBC], context)?.id,
    ).toBe('heavy-bc');
  });

  it('明示指定がアーカイブ済みで使えなければ自動解決へ落ち、そこで曖昧なら ambiguous', () => {
    const archived = factor({ id: 'archived', energyType: 'fuel_heavy_oil', status: 'archived' });
    expect(
      resolveEmissionFactorDetailed(
        record({ ...heavyRecord, emissionFactorId: 'archived' }),
        [archived, heavyA, heavyBC],
        context,
      ).status,
    ).toBe('ambiguous');
  });

  it('上位の優先度（拠点カスタム）が 1 件なら下位に複数あっても曖昧ではない', () => {
    // unit は heavyRecord（L）から換算できるものにする（単位不一致の係数は採用されない）
    const locCustom = factor({ id: 'loc-custom', name: '自社重油', energyType: 'fuel_heavy_oil', unit: 't-CO2e/kL', isCustom: true, locationId: LOC });
    expect(resolveEmissionFactor(heavyRecord, [heavyA, heavyBC, locCustom], context)?.id).toBe('loc-custom');
  });

  it('調整後が 1 件で基礎が複数あっても、先頭（調整後）は曖昧ではない', () => {
    const adjusted = factor({ id: 'adj', name: '電気（調整後）', factorType: 'adjusted' });
    const basic1 = factor({ id: 'b1', name: '電気（基礎1）', factorType: 'basic' });
    const basic2 = factor({ id: 'b2', name: '電気（基礎2）', factorType: 'basic' });
    expect(resolveEmissionFactor(record(), [basic1, basic2, adjusted], { applicableYear: 2024 })?.id).toBe('adj');
  });

  it('同名の重複登録は id 順で決めても結果が変わらないため曖昧としない', () => {
    const dup1 = factor({ id: 'dup-1', name: '電気 代替値' });
    const dup2 = factor({ id: 'dup-2', name: '電気 代替値' });
    expect(resolveEmissionFactor(record(), [dup2, dup1], { applicableYear: 2024 })?.id).toBe('dup-1');
  });

  it('全国の代替値 1 件（電気・都市ガス・熱の想定）は曖昧にならない', () => {
    expect(resolveEmissionFactorDetailed(record(), [factor()], { applicableYear: 2024 }).status).toBe('resolved');
  });
});

describe('単位互換による絞り込み', () => {
  // energyType='fuel' の公式係数は同じ優先度（全国標準）に tCO2/t・tCO2/千m3・tCO2/kL が混在する。
  // id 昇順で換算不能な係数が先頭に来る並びを再現する（fuel-a < fuel-b < fuel-c）。
  const perTonne = factor({ id: 'fuel-a', name: '燃料 原料炭', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/t' });
  const perThousandM3 = factor({ id: 'fuel-b', name: '燃料 天然ガス', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/千m3' });
  const perKl = factor({ id: 'fuel-c', name: '燃料 灯油', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/kL' });
  const litreRecord = record({ energyType: 'fuel', unit: 'L' });

  it('同順位に換算不能な係数と換算可能な係数が混在するとき、並び順によらず換算可能な方が選ばれる', () => {
    expect(resolveEmissionFactor(litreRecord, [perTonne, perThousandM3, perKl], context)?.id).toBe('fuel-c');
    expect(resolveEmissionFactor(litreRecord, [perKl, perThousandM3, perTonne], context)?.id).toBe('fuel-c');
  });

  it('全候補が換算不能なら unit_mismatch（弾かれた係数を candidates に持つ）', () => {
    const resolution = resolveEmissionFactorDetailed(litreRecord, [perTonne, perThousandM3], context);
    expect(resolution.status).toBe('unit_mismatch');
    if (resolution.status === 'unit_mismatch') {
      expect(resolution.candidates.map((candidate) => candidate.id)).toEqual(['fuel-a', 'fuel-b']);
    }
    expect(resolveEmissionFactor(litreRecord, [perTonne, perThousandM3], context)).toBeNull();
  });

  it('unit を渡さなければ従来どおり単位を見ずに優先順位（id 昇順）で解決する', () => {
    const noUnit = { locationId: LOC, energyType: 'fuel' as const, periodStart: '2024-05-01' };
    expect(resolveEmissionFactorDetailed(noUnit, [perTonne, perThousandM3, perKl], context).status).toBe('ambiguous');
    expect(resolveEmissionFactor({ ...noUnit, unit: null }, [perKl], context)?.id).toBe('fuel-c');
    expect(resolveEmissionFactor(noUnit, [perTonne], context)?.id).toBe('fuel-a');
  });

  it('候補一覧（listFactorCandidates）は単位で絞らない（フォームでは係数側の単位で入力し直せる）', () => {
    expect(listFactorCandidates(litreRecord, [perTonne, perKl], context).map((candidate) => candidate.id)).toEqual([
      'fuel-a',
      'fuel-c',
    ]);
  });

  it('曖昧判定は換算可能な候補の中だけで行う（換算不能な別名の係数は曖昧の理由にならない）', () => {
    expect(resolveEmissionFactorDetailed(litreRecord, [perTonne, perKl], context)).toEqual({
      status: 'resolved',
      factor: perKl,
      kind: 'auto',
      requestedFactorId: null,
    });

    const perKl2 = factor({ id: 'fuel-d', name: '燃料 軽油', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/kL' });
    const resolution = resolveEmissionFactorDetailed(litreRecord, [perTonne, perKl, perKl2], context);
    expect(resolution.status).toBe('ambiguous');
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates.map((candidate) => candidate.id)).toEqual(['fuel-c', 'fuel-d']);
    }
  });

  it('上位の優先度段階が全滅なら下位段階の換算可能な係数へは落ちず unit_mismatch', () => {
    const locCustom = factor({
      id: 'loc-custom',
      name: '自社燃料',
      energyType: 'fuel',
      scope: 'scope1',
      unit: 't-CO2e/t',
      isCustom: true,
      locationId: LOC,
    });
    const resolution = resolveEmissionFactorDetailed(litreRecord, [perKl, locCustom], context);
    expect(resolution.status).toBe('unit_mismatch');
    if (resolution.status === 'unit_mismatch') {
      expect(resolution.candidates.map((candidate) => candidate.id)).toEqual(['loc-custom']);
    }
  });

  it('明示指定の係数は単位に関係なく採用する（換算可否は算定側で判定する）', () => {
    expect(
      resolveEmissionFactor(record({ ...litreRecord, emissionFactorId: 'fuel-a' }), [perTonne, perKl], context)?.id,
    ).toBe('fuel-a');
  });

  it('タイブレーク（調整後優先）は単位互換で絞った後も維持される', () => {
    const basicKl = factor({ id: 'z-basic', name: '燃料 灯油', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/kL', factorType: 'basic' });
    const adjustedKl = factor({ id: 'z-adjusted', name: '燃料 灯油', energyType: 'fuel', scope: 'scope1', unit: 'tCO2/kL', factorType: 'adjusted' });
    expect(resolveEmissionFactor(litreRecord, [perTonne, basicKl, adjustedKl], context)?.id).toBe('z-adjusted');
  });
});

describe('未公表年度の暫定適用', () => {
  // 対象年度（2024）の公式係数がまだ公表されていない状況。
  const rec = record({ periodStart: '2024-05-01' });

  it('対象年度の公式係数が無ければ、直近の過年度を暫定適用する', () => {
    const y2023 = factor({ id: 'fac-2023', applicableYear: 2023 });
    expect(resolveEmissionFactor(rec, [y2023], context)?.id).toBe('fac-2023');
  });

  it('暫定適用した係数は isProvisionalFactor で判別できる', () => {
    const y2023 = factor({ id: 'fac-2023', applicableYear: 2023 });
    const y2024 = factor({ id: 'fac-2024', applicableYear: 2024 });
    expect(isProvisionalFactor(y2023, rec.periodStart)).toBe(true);
    expect(isProvisionalFactor(y2024, rec.periodStart)).toBe(false);
  });

  it('暫定適用では有効期間（effectiveTo が前年度末）で弾かれない', () => {
    const y2023 = factor({
      id: 'fac-2023',
      applicableYear: 2023,
      effectiveFrom: '2023-04-01',
      effectiveTo: '2024-03-31',
    });
    expect(resolveEmissionFactor(rec, [y2023], context)?.id).toBe('fac-2023');
  });

  it('対象年度が公表されたら暫定適用は自動的に止まる', () => {
    const y2023 = factor({ id: 'fac-2023', applicableYear: 2023 });
    const y2024 = factor({
      id: 'fac-2024',
      applicableYear: 2024,
      effectiveFrom: '2024-04-01',
      effectiveTo: '2025-03-31',
    });
    const resolved = resolveEmissionFactor(rec, [y2023, y2024], context);
    expect(resolved?.id).toBe('fac-2024');
    expect(isProvisionalFactor(resolved!, rec.periodStart)).toBe(false);
  });

  it('カスタム係数は暫定適用しない（年度完全一致のみ）', () => {
    const custom2023 = factor({
      id: 'custom-2023',
      applicableYear: 2023,
      isCustom: true,
      locationId: LOC,
    });
    expect(resolveEmissionFactor(rec, [custom2023], context)).toBeNull();
  });

  it('前年のカスタム係数は暫定適用に便乗しない（勝つのは公式係数）', () => {
    // 公式の前年係数があると provisionalYear が前年になる。前年のカスタム係数がその年度に
    // 便乗すると tier1 として公式係数（tier5）の暫定適用に勝ってしまうため、候補にも載せない。
    const official2023 = factor({
      id: 'std-2023',
      applicableYear: 2023,
      effectiveFrom: '2023-04-01',
      effectiveTo: '2024-03-31',
    });
    const custom2023 = factor({
      id: 'custom-2023',
      applicableYear: 2023,
      isCustom: true,
      locationId: LOC,
    });
    expect(resolveEmissionFactor(rec, [official2023, custom2023], context)?.id).toBe('std-2023');
    expect(
      listFactorCandidates(rec, [official2023, custom2023], context).map((candidate) => candidate.id),
    ).toEqual(['std-2023']);
    expect(
      filterApplicableFactors([official2023, custom2023], rec, context).map((candidate) => candidate.id),
    ).toEqual(['std-2023']);
  });

  it('組織全体の前年カスタム係数も暫定適用に便乗しない', () => {
    const official2023 = factor({ id: 'std-2023', applicableYear: 2023 });
    const orgCustom2023 = factor({
      id: 'org-custom-2023',
      applicableYear: 2023,
      isCustom: true,
      locationId: null,
    });
    expect(resolveEmissionFactor(rec, [official2023, orgCustom2023], context)?.id).toBe('std-2023');
  });

  it('カスタム係数しか無い年度でも、公式係数の暫定適用は独立して効く', () => {
    // 2024 のカスタム係数（tier1）と 2023 の公式係数（tier5）。勝つのはカスタム側。
    const custom2024 = factor({
      id: 'custom-2024',
      applicableYear: 2024,
      isCustom: true,
      locationId: LOC,
    });
    const y2023 = factor({ id: 'fac-2023', applicableYear: 2023 });
    expect(resolveEmissionFactor(rec, [custom2024, y2023], context)?.id).toBe('custom-2024');
  });

  it('暫定適用は energyType ごとに独立している', () => {
    // 燃料は2024年度が公表済み、電気は未公表という混在状態。
    const fuel2024 = factor({
      id: 'fuel-2024',
      energyType: 'fuel_kerosene',
      scope: 'scope1',
      applicableYear: 2024,
      unit: 't-CO2e/L',
    });
    const power2023 = factor({ id: 'power-2023', applicableYear: 2023 });
    const factors = [fuel2024, power2023];
    expect(resolveEmissionFactor(rec, factors, context)?.id).toBe('power-2023');
    expect(
      resolveEmissionFactor(
        record({ energyType: 'fuel_kerosene', unit: 'L' }),
        factors,
        context,
      )?.id,
    ).toBe('fuel-2024');
  });

  it('archived の行は公表済みの年度として数えない', () => {
    const archived2024 = factor({ id: 'fac-2024', applicableYear: 2024, status: 'archived' });
    const y2023 = factor({ id: 'fac-2023', applicableYear: 2023 });
    expect(resolveEmissionFactor(rec, [archived2024, y2023], context)?.id).toBe('fac-2023');
  });

  it('明示指定した過年度の係数も暫定適用として使える', () => {
    const provider2023 = factor({
      id: 'provider-2023',
      applicableYear: 2023,
      providerName: '○○電力',
      factorType: 'adjusted',
      effectiveTo: '2024-03-31',
    });
    expect(
      resolveEmissionFactor(
        { ...rec, emissionFactorId: 'provider-2023' },
        [provider2023],
        context,
      )?.id,
    ).toBe('provider-2023');
  });

  describe('非4月始まりの会計年度が温対法年度をまたいだ後の月', () => {
    // 7月始まり FY2025（2025-07-01〜2026-06-30）。2026-04〜06 の温対法年度は 2026 で、
    // 会計年度の開始年 2025 と食い違う。2026年度が未公表の間は 2025年度の係数を暫定適用する。
    const julyContext = { applicableYear: 2025, regionName: '東京電力管内' };
    const crossingRecord = record({ periodStart: '2026-04-01', periodEnd: '2026-04-30' });
    const official2025 = factor({
      id: 'std-2025',
      applicableYear: 2025,
      effectiveFrom: '2025-04-01',
      effectiveTo: '2026-03-31',
    });

    it('温対法年度が未公表なら、会計年度の開始年の係数を有効期間外でも暫定適用する', () => {
      expect(resolveEmissionFactor(crossingRecord, [official2025], julyContext)?.id).toBe('std-2025');
      expect(isProvisionalFactor(official2025, crossingRecord.periodStart)).toBe(true);
    });

    it('会計年度の開始年に登録されたカスタム係数は従来どおり通る（基準年度側の一致）', () => {
      // 開始年 2025 は暫定適用の年度でもあるが、基準年度（applicableYearsForRecord）にも
      // 含まれるため、カスタム係数を暫定適用から外しても候補から落ちない。
      const custom2025 = factor({
        id: 'custom-2025',
        applicableYear: 2025,
        isCustom: true,
        locationId: LOC,
      });
      expect(
        resolveEmissionFactor(crossingRecord, [official2025, custom2025], julyContext)?.id,
      ).toBe('custom-2025');
    });

    it('またぐ前の月は暫定適用にならない（有効期間内でそのまま解決する）', () => {
      const beforeCrossing = record({ periodStart: '2025-08-01', periodEnd: '2025-08-31' });
      expect(resolveEmissionFactor(beforeCrossing, [official2025], julyContext)?.id).toBe('std-2025');
      expect(isProvisionalFactor(official2025, beforeCrossing.periodStart)).toBe(false);
    });

    it('温対法年度が公表されたら正式係数に切り替わり、過年度の係数は候補から外れる', () => {
      const official2026 = factor({
        id: 'std-2026',
        applicableYear: 2026,
        effectiveFrom: '2026-04-01',
        effectiveTo: '2027-03-31',
      });
      expect(
        filterApplicableFactors([official2025, official2026], crossingRecord, julyContext).map(
          (candidate) => candidate.id,
        ),
      ).toEqual(['std-2026']);
      expect(isProvisionalFactor(official2026, crossingRecord.periodStart)).toBe(false);
    });

    it('公表済みの温対法年度の係数で算定済みなら再算定対象にならない', () => {
      const current = [factor({ id: 'std-2026', applicableYear: 2026 }), official2025];
      const target = { energyType: 'electricity' as const, periodStart: '2026-04-01' };
      expect(isSupersededProvisionalFactor(official2025, target, current)).toBe(true);
      expect(isSupersededProvisionalFactor(official2025, target, [official2025])).toBe(false);
    });
  });
});

describe('filterApplicableFactors', () => {
  // 入力フォームはフォールバック年度も含めて係数を取得する（withProvisionalYears）ため、
  // 画面に並べる前に「このレコードで算定バッチが採用し得る行」だけに絞る。
  const rec = record({ periodStart: '2024-05-01' });
  const official = (id: string, applicableYear: number, overrides: Partial<EmissionFactorRow> = {}) =>
    factor({
      id,
      organizationId: null,
      applicableYear,
      effectiveFrom: `${applicableYear}-04-01`,
      effectiveTo: `${applicableYear + 1}-03-31`,
      ...overrides,
    });

  it('対象年度が公表済みなら過年度の行は落ちる（事業者係数も同様）', () => {
    const rows = [
      official('std-2023', 2023),
      official('std-2024', 2024),
      official('tepco-2023', 2023, { providerName: '東京電力EP', factorType: 'adjusted' }),
      official('tepco-2024', 2024, { providerName: '東京電力EP', factorType: 'adjusted' }),
    ];
    expect(filterApplicableFactors(rows, rec, context).map((f) => f.id)).toEqual(['std-2024', 'tepco-2024']);
  });

  it('対象年度が未公表なら直近の過年度の行を残す（暫定適用）', () => {
    const rows = [
      official('std-2023', 2023),
      official('tepco-2023', 2023, { providerName: '東京電力EP', factorType: 'adjusted' }),
    ];
    expect(filterApplicableFactors(rows, rec, context).map((f) => f.id)).toEqual(['std-2023', 'tepco-2023']);
  });

  it('公表済みかは渡した集合全体で判定する（標準係数が対象年度にあれば事業者係数の過年度行は落ちる）', () => {
    const rows = [
      official('std-2024', 2024),
      official('tepco-2023', 2023, { providerName: '東京電力EP', factorType: 'adjusted' }),
    ];
    expect(filterApplicableFactors(rows, rec, context).map((f) => f.id)).toEqual(['std-2024']);
  });

  it('energyType 違い・archived・有効期間外の行は対象年度でも落ちる', () => {
    const rows = [
      official('gas-2024', 2024, { energyType: 'city_gas' }),
      official('archived-2024', 2024, { status: 'archived' }),
      official('expired-2024', 2024, { effectiveTo: '2024-04-30' }),
      official('std-2024', 2024),
    ];
    expect(filterApplicableFactors(rows, rec, context).map((f) => f.id)).toEqual(['std-2024']);
  });
});

describe('withProvisionalYears', () => {
  it('取得対象の年度にフォールバック年度を足す', () => {
    expect(withProvisionalYears([2024])).toEqual([2023, 2024]);
    expect(withProvisionalYears([2025, 2026])).toEqual([2024, 2025, 2026]);
  });

  it('遡りは PROVISIONAL_FALLBACK_YEARS 年ぶんだけ', () => {
    expect(PROVISIONAL_FALLBACK_YEARS).toBe(1);
    expect(withProvisionalYears([2024])).not.toContain(2022);
  });
});

describe('isSupersededProvisionalFactor', () => {
  // FY2026（4月始まり）の 2026-05 レコードを、2025年度係数で暫定適用して算定済みの状態。
  const applied = factor({ id: 'std-2025', applicableYear: 2025 });
  const rec = { energyType: 'electricity' as const, periodStart: '2026-05-01' };

  it('対象年度の公式係数が入ったら再算定対象になる', () => {
    const current = [factor({ id: 'std-2026', applicableYear: 2026 }), applied];
    expect(isSupersededProvisionalFactor(applied, rec, current)).toBe(true);
  });

  it('対象年度がまだ未公表なら再算定対象にしない（暫定適用の継続）', () => {
    expect(isSupersededProvisionalFactor(applied, rec, [applied])).toBe(false);
  });

  it('対象年度の行があってもカスタム係数・archived は「公表済み」に数えない', () => {
    const custom = factor({ id: 'custom-2026', applicableYear: 2026, isCustom: true });
    const archived = factor({ id: 'std-2026', applicableYear: 2026, status: 'archived' });
    expect(isSupersededProvisionalFactor(applied, rec, [applied, custom, archived])).toBe(false);
  });

  it('別 energyType の対象年度係数では解消しない', () => {
    const gas = factor({ id: 'gas-2026', applicableYear: 2026, energyType: 'city_gas' });
    expect(isSupersededProvisionalFactor(applied, rec, [applied, gas])).toBe(false);
  });

  it('対象年度の係数で算定済みのレコードは対象外', () => {
    const current = [factor({ id: 'std-2026', applicableYear: 2026 })];
    expect(isSupersededProvisionalFactor(current[0], rec, current)).toBe(false);
  });

  it('カスタム係数で算定済みのレコードは対象外（暫定適用の対象外のため）', () => {
    const appliedCustom = factor({ id: 'custom-2025', applicableYear: 2025, isCustom: true });
    const current = [factor({ id: 'std-2026', applicableYear: 2026 }), appliedCustom];
    expect(isSupersededProvisionalFactor(appliedCustom, rec, current)).toBe(false);
  });

  it('非4月始まり会計年度で基準年度に入る過年度係数は再算定対象にしない', () => {
    // 1月始まり FY2026 の 2026-01 レコードは基準年度が {2025, 2026}。2025年度係数の適用は暫定適用ではない。
    const januaryRecord = { energyType: 'electricity' as const, periodStart: '2026-01-15' };
    const current = [factor({ id: 'std-2026', applicableYear: 2026 }), applied];
    expect(isSupersededProvisionalFactor(applied, januaryRecord, current)).toBe(false);
  });
});
