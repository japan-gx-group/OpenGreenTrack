import { describe, expect, it } from 'vitest';
import type { IdeaProductDetail } from '@/features/factors/services/ideaProductSearch';
import type { CandidateFactorRow } from '../factorSelectionService';
import {
  amountFieldLabel,
  buildCalculationResultView,
  buildIdeaSelectOptions,
  buildPreviewRows,
  factorNameWithValue,
  factorProviderOrRegionText,
  factorSourceRowText,
  factorSourceText,
  formatEmissions,
  ideaFactorValueText,
  ideaProductText,
  ideaSourceText,
} from '../entryFormat';

// 統合データ入力フォームの表示整形（純関数）のテスト。
// 計算結果ブロックの分岐、プレビュー行の並び（Scope 1・2・3 で同じ 8 行）、係数の参照方式の文言を固定する。
// IDEA の値はダミー（仕様 §0.1: 実データ値をテストに入れない）。

const factor = (overrides: Partial<CandidateFactorRow> & { id: string }): CandidateFactorRow => ({
  organizationId: null,
  name: `係数 ${overrides.id}`,
  energyType: 'electricity',
  scope: 'scope2',
  factorValue: 0.00055,
  unit: 't-CO2/kWh',
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
  factorType: 'adjusted',
  source: 'moe',
  sourceDocumentName: null,
  ...overrides,
});

const national = factor({ id: 'national', name: '電気（代替値・全国）' });
const detail: IdeaProductDetail = {
  id: 'idea-1',
  ideaCode: '000000001mDMY',
  productName: 'ダミー製品',
  country: 'JPN',
  unit: 'kg',
  organizationId: 'org',
  importId: 'imp',
  baseFlowAmount: '1',
  gwpValue: '1.5',
  importVersion: 'Ver.X 標準版',
};
const period = { start: '2024-11-01', end: '2024-11-30' };

describe('表示文字列', () => {
  it('排出量は ja-JP 小数第3位、係数・出典・事業者/地域を整形する', () => {
    expect(formatEmissions(5.5)).toBe('5.5');
    expect(formatEmissions(0.1234567)).toBe('0.123');
    expect(formatEmissions(1234.5)).toBe('1,234.5');
    expect(factorNameWithValue(national)).toBe('電気（代替値・全国）（0.00055 t-CO2/kWh）');
    expect(factorSourceText(national)).toBe('環境省');
    expect(factorSourceText(factor({ id: 'x', source: 'ketsoho', sourceDocumentName: '算定方法・排出係数一覧' }))).toBe(
      '温対法（算定方法・排出係数一覧）',
    );
    expect(factorProviderOrRegionText(national)).toEqual({ label: '地域', value: '全国' });
    expect(
      factorProviderOrRegionText(factor({ id: 'p', providerName: '関西電力', menuName: 'メニューA' })),
    ).toEqual({ label: '事業者', value: '関西電力（メニューA）' });
  });

  it('IDEA の原単位・出典・製品表記（gwpValue / baseFlowAmount が string でも計算できる）', () => {
    expect(ideaFactorValueText(detail)).toBe('1.5 kg-CO2e/kg');
    expect(ideaSourceText(detail)).toBe('AIST-IDEA Ver.X 標準版');
    expect(ideaSourceText({ ...detail, importVersion: null })).toBe('AIST-IDEA');
    expect(ideaProductText(detail)).toBe('ダミー製品（JPN / kg）');
  });

  it('活動量ラベルは「円」のときだけ金額表記', () => {
    expect(amountFieldLabel('kWh')).toBe('活動量');
    expect(amountFieldLabel(null)).toBe('活動量');
    expect(amountFieldLabel('円')).toBe('金額（活動量として保存）');
  });

  it('選択中の製品が検索結果に無ければ先頭に補う', () => {
    const other = { id: 'idea-2', ideaCode: '000000002mDMY', productName: '別製品', country: 'GLO', unit: 't' };
    expect(buildIdeaSelectOptions([other], detail, 'idea-1').map((o) => o.value)).toEqual(['idea-1', 'idea-2']);
    expect(buildIdeaSelectOptions([other, detail], detail, 'idea-1').map((o) => o.value)).toEqual(['idea-2', 'idea-1']);
    expect(buildIdeaSelectOptions([other], detail, null).map((o) => o.value)).toEqual(['idea-2']);
  });
});

describe('buildCalculationResultView', () => {
  const base = {
    factorSource: 'standard' as const,
    hasPeriod: true,
    amount: 10000,
    unit: 'kWh',
    factorsReady: true,
    appliedFactor: national,
    productDetail: null,
    estimatedEmissions: 5.5,
  };

  it('対象年月 → 係数（製品）確定 → 活動量 → 換算可 の順に判定する', () => {
    expect(buildCalculationResultView({ ...base, hasPeriod: false })).toEqual({
      kind: 'idle',
      message: '対象年月を正しく選択すると計算結果を表示します。',
    });
    expect(
      buildCalculationResultView({ ...base, factorSource: 'idea', hasPeriod: false, productDetail: detail, unit: 'kg', estimatedEmissions: null }),
    ).toMatchObject({ kind: 'idle', message: '対象年月を正しく選択すると計算結果を表示します。' });
    expect(buildCalculationResultView({ ...base, factorsReady: false })).toEqual({
      kind: 'idle',
      message: '適用する排出係数が確定すると計算結果を表示します。',
    });
    expect(buildCalculationResultView({ ...base, appliedFactor: null })).toMatchObject({ kind: 'idle' });
    expect(buildCalculationResultView({ ...base, amount: null })).toEqual({
      kind: 'idle',
      message: '活動量を入力すると計算結果を表示します。',
    });
    expect(buildCalculationResultView({ ...base, unit: '円', estimatedEmissions: null })).toEqual({
      kind: 'unit-mismatch',
      message:
        '活動量の単位「円」を係数の単位「t-CO2/kWh」に換算できないため計算できません。このまま保存した場合、排出量は未算定として記録されます。',
    });
    expect(buildCalculationResultView(base)).toEqual({
      kind: 'result',
      amountText: '10,000',
      unit: 'kWh',
      factorText: '0.00055 t-CO2/kWh',
      emissionsText: '5.5 t-CO2e',
    });
  });

  it('IDEA は製品未選択なら案内、単位換算不能は製品固有の警告', () => {
    expect(
      buildCalculationResultView({ ...base, factorSource: 'idea', appliedFactor: null, productDetail: null }),
    ).toEqual({ kind: 'idle', message: 'IDEA製品を選択すると計算結果を表示します。' });
    expect(
      buildCalculationResultView({
        ...base,
        factorSource: 'idea',
        appliedFactor: null,
        productDetail: detail,
        unit: 'kg',
        estimatedEmissions: null,
      }),
    ).toEqual({ kind: 'unit-mismatch', message: 'この製品の単位「kg」では排出量を計算できません。' });
    expect(
      buildCalculationResultView({
        ...base,
        factorSource: 'idea',
        appliedFactor: null,
        productDetail: detail,
        unit: 'kg',
        amount: 1000,
        estimatedEmissions: 1.5,
      }),
    ).toMatchObject({ kind: 'result', factorText: '1.5 kg-CO2e/kg', emissionsText: '1.5 t-CO2e' });
  });
});

describe('factorSourceRowText', () => {
  it('参照方式ごとに自動選択・代替値・候補からの変更を補足する', () => {
    const row = (
      factorSource: 'provider' | 'standard' | 'idea',
      isProviderFactorSelected: boolean,
      isCandidateOverridden: boolean,
      isSavedFactorKeptUnknown = false,
    ) => factorSourceRowText({ factorSource, isProviderFactorSelected, isCandidateOverridden, isSavedFactorKeptUnknown });
    expect(row('provider', true, false)).toBe('供給事業者別係数');
    expect(row('provider', false, false)).toBe('供給事業者別係数（供給事業者未選択のため代替値）');
    expect(row('provider', false, false, true)).toBe('供給事業者別係数（保存されている係数指定を維持）');
    expect(row('standard', false, false)).toBe('標準係数（自動選択）');
    expect(row('standard', false, true)).toBe('標準係数（候補から変更）');
    expect(row('idea', false, false)).toBe('IDEA 原単位');
  });
});

describe('buildPreviewRows', () => {
  const base = {
    category: { kind: 'energy' as const, energyType: 'electricity' as const },
    factorSource: 'provider' as const,
    locationName: '大阪支社',
    period,
    amount: 10000,
    unit: 'kWh',
    isNonStandardUnit: false,
    note: '',
    factorSourceText: '供給事業者別係数（供給事業者未選択のため代替値）',
    appliedFactor: national,
    willFallBackFromSavedFactor: false,
    savedFactorKept: false,
    appliedFactorUnknown: null,
    productDetail: null,
    estimatedEmissions: 5.5,
  };

  it('Scope1/2 は 8 行の固定順で、適用係数に出典と地域の補足を付ける', () => {
    const rows = buildPreviewRows(base);
    expect(rows.map((row) => row.label)).toEqual([
      '拠点名',
      'カテゴリ',
      '対象期間',
      '活動量',
      '係数の参照方式',
      '適用係数',
      '推定排出量',
      '備考',
    ]);
    expect(rows[1].value).toBe('電気');
    expect(rows[2].value).toBe('2024-11-01 ～ 2024-11-30');
    expect(rows[3]).toEqual({ label: '活動量', value: '10,000 kWh', note: undefined });
    expect(rows[5]).toEqual({
      label: '適用係数',
      value: '電気（代替値・全国）（0.00055 t-CO2/kWh）',
      note: '出典: 環境省 / 地域: 全国',
    });
    expect(rows[6].value).toBe('5.5 t-CO2e');
    expect(rows[7].value).toBe('—');
  });

  it('適用係数の 4 形（フォールバック注記 / 判定不能 2 種 / 係数なし）', () => {
    expect(buildPreviewRows({ ...base, willFallBackFromSavedFactor: true, savedFactorKept: true })[5].value).toBe(
      '電気（代替値・全国）（0.00055 t-CO2/kWh）（保存されていた係数は適用できないため自動選択）',
    );
    expect(buildPreviewRows({ ...base, willFallBackFromSavedFactor: true })[5].value).toBe(
      '電気（代替値・全国）（0.00055 t-CO2/kWh）（選択した係数は有効期間外のため自動選択）',
    );
    expect(buildPreviewRows({ ...base, savedFactorRemapped: true })[5].value).toBe(
      '電気（代替値・全国）（0.00055 t-CO2/kWh）（保存されていた係数は年度更新で入れ替わったため、同じ事業者の現在の係数を適用）',
    );
    expect(buildPreviewRows({ ...base, appliedFactorUnknown: 'provider' })[5].value).toContain(
      '事業者リストを取得できないため確認できません',
    );
    expect(buildPreviewRows({ ...base, appliedFactorUnknown: 'standard' })[5].value).toContain(
      '排出係数を取得できないため確認できません',
    );
    expect(buildPreviewRows({ ...base, appliedFactor: null, estimatedEmissions: null })[5].value).toBe(
      '—（適用できる係数が無いため未算定として保存されます）',
    );
  });

  it('非標準単位は活動量行に補足を付ける', () => {
    expect(buildPreviewRows({ ...base, unit: 'MWh', isNonStandardUnit: true })[3]).toEqual({
      label: '活動量',
      value: '10,000 MWh',
      note: '記録の単位（取込データ）をそのまま保持します',
    });
  });

  it('IDEA も同じ 8 行で、適用係数行に製品・原単位・出典を出す', () => {
    const rows = buildPreviewRows({
      ...base,
      category: { kind: 'scope3', categoryId: 1 },
      factorSource: 'idea',
      unit: 'kg',
      amount: 1000,
      factorSourceText: 'IDEA 原単位',
      appliedFactor: null,
      productDetail: detail,
      estimatedEmissions: 1.5,
      note: 'メモ',
    });
    expect(rows).toHaveLength(8);
    expect(rows[1].value).toBe('カテゴリ1: 購入した製品・サービス');
    expect(rows[5]).toEqual({
      label: '適用係数',
      value: 'ダミー製品（JPN / kg）',
      note: '原単位: 1.5 kg-CO2e/kg / 出典: AIST-IDEA Ver.X 標準版',
    });
    expect(rows[7].value).toBe('メモ');
  });
});
