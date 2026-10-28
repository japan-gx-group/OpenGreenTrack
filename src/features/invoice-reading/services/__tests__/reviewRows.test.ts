import { describe, expect, it } from 'vitest';
import type { CandidateFactorRow } from '@/features/data-input/services/factorSelectionService';
import type { ManualEntryLocationOption, SavedManualActivityRecord } from '@/features/data-input/types';
import type { EvidenceFile } from '@/features/activity-evidence/types';
import type { InvoiceReadingItem, InvoiceReadingResult } from '../../types';
import type { RowFactorView } from '../rowFactorResolution';
import {
  buildReviewRowSources,
  buildRowEntry,
  buildRowPrefill,
  checkReviewRow,
  initialRowValues,
  listUnregistrableItems,
  type ReviewRowSource,
  type ReviewRowValues,
} from '../reviewRows';

// 一括登録の表の行: 読み取りの結果から行を作り、必須項目・重複（登録済み・表の中）を errors に、
// 係数で確かめてほしいことを warnings に分け、表で直した値で保存する内容とフォームに入れる値を組み立てる。

const EVIDENCE: EvidenceFile = {
  id: 'file-1',
  fileName: '9月分.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  convertedFrom: null,
  storagePath: 'org/activity-evidence/file-1.pdf',
  createdAt: '2026-10-26T00:00:00Z',
  uploadedBy: 'user-1',
};

const TOKYO: ManualEntryLocationOption = { id: 'tokyo', name: '東京本社', region: 'Kanto' };
const OSAKA: ManualEntryLocationOption = { id: 'osaka', name: '大阪支社', region: 'Kansai' };
const LOCATIONS = [TOKYO, OSAKA];
const TEPCO = '東京電力エナジーパートナー(株)';

const electricityItem: InvoiceReadingItem = {
  index: 1,
  energyType: 'electricity',
  title: '電気 2025年9月分',
  targetMonth: '2025-09',
  amount: { value: 1000, unit: 'kWh' },
  printedAmount: '1,000 kWh',
  planOrFuelName: 'スタンダードS',
  factor: { status: 'matched', label: `${TEPCO} / メニューL(残差)`, reason: '残差を選んだ' },
  location: { id: 'tokyo', name: '東京本社' },
  notices: [],
  prefill: {
    locationId: 'tokyo',
    supplyAddress: '東京都架空区架空町1-1-1',
    energyType: 'electricity',
    targetMonth: '2025-09',
    amount: '1000',
    note: '請求書から読取り',
    factor: { kind: 'provider', providerName: TEPCO, menuName: 'メニューL(残差)' },
    sourceLabel: '請求書「9月分.pdf」から読み取った値を入れました。',
    evidenceFiles: [EVIDENCE],
  },
};

const gasolineItem: InvoiceReadingItem = {
  ...electricityItem,
  index: 2,
  energyType: 'fuel_gasoline',
  title: 'ガソリン 2025年9月分',
  targetMonth: null,
  amount: { value: 30, unit: 'L' },
  printedAmount: '30 L',
  planOrFuelName: 'レギュラー',
  factor: { status: 'matched', label: '燃料 揮発油', reason: '揮発油' },
  location: null,
  prefill: {
    ...electricityItem.prefill!,
    locationId: '',
    energyType: 'fuel_gasoline',
    targetMonth: null,
    amount: '30',
    factor: { kind: 'standard', factorName: '燃料 揮発油' },
  },
};

const otherItem: InvoiceReadingItem = {
  ...electricityItem,
  index: 3,
  energyType: null,
  title: '水道',
  factor: { status: 'unavailable', reason: '対象外の請求書です' },
  notices: ['電気・都市ガス・燃料のほかは入れられません'],
  prefill: null,
};

const RESULT: InvoiceReadingResult = {
  evidence: EVIDENCE,
  supplierName: '東京電力エナジーパートナー株式会社',
  supplyAddress: '東京都架空区架空町1-1-1',
  warnings: [],
  items: [electricityItem, gasolineItem, otherItem],
  provider: 'google',
  modelId: 'gemini-3.5-flash',
};

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

const MENU_L = factor({ id: 'tepco-l', name: `${TEPCO} メニューL(残差)`, providerName: TEPCO, menuName: 'メニューL(残差)' });
const NATIONAL = factor({ id: 'national', name: '電気 代替値（全国）', factorValue: 0.00044 });

const view = (overrides: Partial<RowFactorView> = {}): RowFactorView => ({
  isProvider: true,
  providerOptions: [],
  menuOptions: [MENU_L],
  candidates: [NATIONAL],
  providerFactor: MENU_L,
  selectedFactor: MENU_L,
  factorIdToSave: MENU_L.id,
  applied: { status: 'resolved', factor: MENU_L, fellBack: false, remapped: false, ambiguous: false, provisional: false },
  ...overrides,
});

const record = (overrides: Partial<SavedManualActivityRecord>): SavedManualActivityRecord => ({
  id: 'rec-1',
  locationId: 'tokyo',
  locationName: '東京本社',
  energyType: 'electricity',
  amount: 100,
  unit: 'kWh',
  periodStart: '2025-09-01',
  periodEnd: '2025-09-30',
  note: null,
  createdAt: '2025-10-01T00:00:00Z',
  emissionFactorId: null,
  emissions: null,
  appliedFactorName: null,
  appliedFactorValue: null,
  appliedFactorUnit: null,
  scope3CategoryId: null,
  ideaFactorId: null,
  ideaProductName: null,
  evidenceCount: 0,
  ...overrides,
});

const [ELECTRICITY, GASOLINE] = buildReviewRowSources([RESULT]);

const check = (
  source: ReviewRowSource,
  values: Partial<ReviewRowValues> = {},
  options: {
    view?: RowFactorView | null;
    historyRecords?: SavedManualActivityRecord[];
    otherRows?: Array<{ source: ReviewRowSource; values: ReviewRowValues }>;
  } = {},
) =>
  checkReviewRow({
    source,
    values: { ...initialRowValues(source), ...values },
    view: options.view === undefined ? view() : options.view,
    locations: LOCATIONS,
    historyRecords: options.historyRecords ?? [],
    otherRows: options.otherRows ?? [],
    maxTargetMonth: '2026-10',
  });

describe('buildReviewRowSources / listUnregistrableItems', () => {
  it('フォームに入れられる明細だけを行にし（キーは帳票と明細の番号）、入れられない明細は別に返す', () => {
    expect(buildReviewRowSources([RESULT]).map((source) => [source.key, source.energyType])).toEqual([
      ['file-1:1', 'electricity'],
      ['file-1:2', 'fuel_gasoline'],
    ]);
    expect(listUnregistrableItems([RESULT])).toEqual([{ evidence: EVIDENCE, item: otherItem }]);
  });
});

describe('initialRowValues', () => {
  it('事業者別係数は事業者とメニュー、標準係数は名前を入れ、読めない対象年月は空にする', () => {
    expect(initialRowValues(ELECTRICITY)).toEqual({
      locationId: 'tokyo',
      targetMonth: '2025-09',
      amount: '1000',
      providerName: TEPCO,
      menuName: 'メニューL(残差)',
      factorName: null,
      selectedFactorId: null,
    });
    expect(initialRowValues(GASOLINE)).toMatchObject({
      locationId: '',
      targetMonth: '',
      providerName: null,
      menuName: null,
      factorName: '燃料 揮発油',
    });
  });
});

describe('checkReviewRow', () => {
  it('拠点・対象年月・活動量がそろわなければ errors に理由を入れ、排出量は出さない', () => {
    const result = check(GASOLINE, { amount: 'abc' }, { view: null });
    expect(result.errors).toEqual([
      '拠点を選んでください',
      '対象年月を選択してください。',
      expect.stringContaining('活動量'),
    ]);
    // 拠点・対象年月が決まらないうちは、係数を確かめている途中とは出さない。
    expect(result.warnings).toEqual([]);
    expect(result.emissions).toBeNull();
  });

  it('同じ拠点・カテゴリ・対象年月の記録が登録済みなら errors にする（DB の重複防止で保存できないため）', () => {
    const result = check(ELECTRICITY, {}, { historyRecords: [record({})] });
    expect(result.errors).toEqual([
      '同じ拠点・カテゴリ・対象年月の記録が登録済みです（合算するなら、入力履歴から既存の記録を開いて直してください）',
    ]);
    // カテゴリか対象年月が違えば重複ではない。
    expect(check(ELECTRICITY, {}, { historyRecords: [record({ energyType: 'city_gas' })] }).errors).toEqual([]);
    expect(check(ELECTRICITY, {}, { historyRecords: [record({ periodStart: '2025-08-01' })] }).errors).toEqual([]);
  });

  it('表の中で先に登録する行と拠点・カテゴリ・対象年月が同じなら errors にする', () => {
    const other = { source: ELECTRICITY, values: initialRowValues(ELECTRICITY) };
    const second = { ...ELECTRICITY, key: 'file-2:1' };
    expect(check(second, {}, { otherRows: [other] }).errors).toEqual([
      '表の中で、先に登録する明細と拠点・カテゴリ・対象年月が同じです（合算して 1 件にしてください）',
    ]);
    expect(check(second, { locationId: 'osaka' }, { otherRows: [other] }).errors).toEqual([]);
  });

  it('係数を確かめている間・メニューが決まらない・係数が無いときは warnings にする', () => {
    expect(check(ELECTRICITY, {}, { view: null }).warnings).toEqual(['排出係数を確認しています']);

    const twoMenus = view({ menuOptions: [MENU_L, { ...MENU_L, id: 'tepco-a', menuName: 'メニューA' }], providerFactor: null });
    expect(check(ELECTRICITY, { menuName: null }, { view: twoMenus }).warnings).toEqual([
      'メニューを選んでください（選ばないと代替値で算定されます）',
    ]);
    expect(check(ELECTRICITY, {}, { view: view({ menuOptions: [], providerFactor: null }) }).warnings).toEqual([
      'この年度の、選んだ事業者の係数が見つかりません。代替値で算定されます',
    ]);

    const none = view({
      applied: { status: 'resolved', factor: null, fellBack: false, remapped: false, ambiguous: false, provisional: false },
    });
    const result = check(ELECTRICITY, {}, { view: none });
    expect(result.warnings).toEqual(['この条件に適用できる排出係数が見つかりません。保存すると未算定になります']);
    expect(result.emissions).toBeNull();
  });

  it('同じ優先度の係数が並んでまだ選んでいないときは、選ぶまで登録できない（errors。単月入力と同じ）', () => {
    const ambiguous = view({
      selectedFactor: null,
      factorIdToSave: null,
      applied: { status: 'resolved', factor: null, fellBack: false, remapped: false, ambiguous: true, provisional: false },
    });
    const result = check(ELECTRICITY, {}, { view: ambiguous });
    expect(result.errors).toEqual([
      '同じ優先度の排出係数が複数あるため、自動では選びません。排出係数の候補から、使った係数を選んでください。',
    ]);
    // 「適用できる係数が無い」とは言わない
    expect(result.warnings).toEqual([]);
    expect(result.emissions).toBeNull();
  });

  it('係数と活動量が決まれば、適用される係数で排出量を出す', () => {
    const result = check(ELECTRICITY);
    expect(result).toEqual({ errors: [], warnings: [], emissions: 0.4 });
  });
});

describe('buildRowEntry', () => {
  it('表で直した値で Scope1/2 の記録を作り、単位はカテゴリの単位、係数は表で決まった ID にする', () => {
    const values = { ...initialRowValues(ELECTRICITY), locationId: 'osaka', targetMonth: '2025-02', amount: '1200' };
    expect(buildRowEntry({ source: ELECTRICITY, values, view: view() })).toEqual({
      kind: 'scope12',
      input: {
        locationId: 'osaka',
        energyType: 'electricity',
        amount: 1200,
        unit: 'kWh',
        periodStart: '2025-02-01',
        periodEnd: '2025-02-28',
        note: '請求書から読取り',
        emissionFactorId: 'tepco-l',
      },
    });
    // 係数が決まらない（解決前）ときは ID を付けず、保存後の算定に任せる。
    expect(buildRowEntry({ source: ELECTRICITY, values, view: null })?.input).toMatchObject({
      emissionFactorId: null,
    });
  });

  it('対象年月・活動量・拠点が決まらなければ作らない', () => {
    const values = initialRowValues(ELECTRICITY);
    expect(buildRowEntry({ source: ELECTRICITY, values: { ...values, targetMonth: '' }, view: view() })).toBeNull();
    expect(buildRowEntry({ source: ELECTRICITY, values: { ...values, amount: 'x' }, view: view() })).toBeNull();
    expect(buildRowEntry({ source: ELECTRICITY, values: { ...values, locationId: '' }, view: view() })).toBeNull();
  });
});

describe('buildRowPrefill', () => {
  it('表で直した値をフォームの値に反映し、帳票はそのまま渡す', () => {
    const values = { ...initialRowValues(ELECTRICITY), locationId: 'osaka', targetMonth: '2025-08', amount: '900', menuName: null };
    expect(buildRowPrefill({ source: ELECTRICITY, values, view: view() })).toEqual({
      ...electricityItem.prefill,
      locationId: 'osaka',
      targetMonth: '2025-08',
      amount: '900',
      factor: { kind: 'provider', providerName: TEPCO, menuName: null },
    });
  });

  it('標準係数を候補から選び直したら、その名前を入れる。事業者別のカテゴリで事業者を外したら係数は入れない', () => {
    const fuelView = view({
      isProvider: false,
      providerFactor: null,
      menuOptions: [],
      selectedFactor: factor({ id: 'kerosene', name: '燃料 灯油', energyType: 'fuel_kerosene' }),
    });
    expect(buildRowPrefill({ source: GASOLINE, values: initialRowValues(GASOLINE), view: fuelView }).factor).toEqual({
      kind: 'standard',
      factorName: '燃料 灯油',
    });

    const noProvider = { ...initialRowValues(ELECTRICITY), providerName: null, menuName: null };
    expect(
      buildRowPrefill({ source: ELECTRICITY, values: noProvider, view: view({ providerFactor: null, selectedFactor: NATIONAL }) }).factor,
    ).toBeNull();
  });
});
