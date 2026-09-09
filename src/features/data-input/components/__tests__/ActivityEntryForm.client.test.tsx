// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, focusElement, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import {
  fetchIdeaImportOverview,
  type IdeaImportRecord,
} from '@/features/factors/services/ideaImportClient';
import {
  getIdeaProductDetail,
  searchIdeaProducts,
  type IdeaProduct,
  type IdeaProductDetail,
} from '@/features/factors/services/ideaProductSearch';
import {
  getActiveScope12Factors,
  getProviderFactors,
  type CandidateFactorRow,
} from '../../services/factorSelectionService';
import { getScope3CategoryMethod } from '../../services/scope3Adoption';
import type { ActivityEntryInitialValues, ManualEntryLocationOption } from '../../types';
import { ActivityEntryForm, type ActivityEntryFormProps } from '../ActivityEntryForm.client';

// 統合データ入力フォーム（ActivityEntryForm）のコンポーネントテスト。
// Supabase を呼ぶ I/O（係数マスタ・事業者別係数・IDEA 取込状況・製品検索・製品詳細）と
// 会計年度コンテキストだけをモックし、フック・純関数・子コンポーネントは実物を通して
// 「画面に何が出て、onSave に何が渡るか」を検証する。

// ---- I/O のモック（純関数・定数は importOriginal で実物を残す） ----

vi.mock('../../services/factorSelectionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/factorSelectionService')>()),
  getActiveScope12Factors: vi.fn(),
  getProviderFactors: vi.fn(),
}));

vi.mock('@/features/factors/services/ideaProductSearch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/factors/services/ideaProductSearch')>()),
  searchIdeaProducts: vi.fn(),
  getIdeaProductDetail: vi.fn(),
}));

vi.mock('@/features/factors/services/ideaImportClient', () => ({
  fetchIdeaImportOverview: vi.fn(),
}));

vi.mock('../../services/scope3Adoption', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/scope3Adoption')>()),
  getScope3CategoryMethod: vi.fn(),
}));

// 会計年度コンテキスト。テストごとに中身を書き換えられるよう可変オブジェクトを返す。
const fiscalYearMock = vi.hoisted(() => ({
  fiscalYearId: 'fy2024' as string | null,
  fiscalYear: '2024',
  fiscalYears: [] as FiscalYearOption[],
  isLoading: false,
  setFiscalYearId: vi.fn(),
  refresh: async () => {},
}));

vi.mock('@/hooks/useFiscalYear', () => ({ useFiscalYear: () => fiscalYearMock }));

// ---- フィクスチャ ----

// 「今日」を 2025-01-15 に固定する。新規入力の既定月（当月 2025-01）と編集の対象月（2024-11 / 2024-12）が
// いずれも会計年度 2024（2024-04-01〜2025-03-31）に収まり、係数の適用年度が常に 2024 になる。
const FIXED_NOW = new Date(2025, 0, 15);

const FY2024: FiscalYearOption = {
  id: 'fy2024',
  label: '2024年度',
  year: '2024',
  startDate: '2024-04-01',
  endDate: '2025-03-31',
};

/** 2 年度目。過年度入力（選択年度と対象年月の帰属年度が違う状態）を作るために使う。 */
const FY2025: FiscalYearOption = {
  id: 'fy2025',
  label: '2025年度',
  year: '2025',
  startDate: '2025-04-01',
  endDate: '2026-03-31',
};

const OSAKA: ManualEntryLocationOption = { id: 'loc-1', name: '大阪支社', region: 'Kanto' };

const TEPCO = '東京電力エナジーパートナー';

const factor = (
  overrides: Pick<CandidateFactorRow, 'id' | 'name' | 'factorValue'> & Partial<CandidateFactorRow>,
): CandidateFactorRow => ({
  organizationId: null,
  energyType: 'electricity',
  scope: 'scope2',
  unit: 't-CO2/kWh',
  applicableYear: 2024,
  regionName: '全国',
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: '2024-04-01',
  effectiveTo: '2025-03-31',
  providerName: null,
  providerNumber: null,
  menuName: null,
  factorType: 'adjusted',
  source: 'moe',
  sourceDocumentName: null,
  ...overrides,
});

/** 全国の代替値（事業者未選択時に自動選択される標準係数） */
const national = factor({ id: 'national', name: '電気（代替値・全国）', factorValue: 0.00055 });
/** 供給事業者別係数（調整後 / 基礎）。自動解決の対象外で、事業者を選んだときだけ適用される */
const tepcoAdjusted = factor({
  id: 'tepco-adjusted',
  name: `${TEPCO}（調整後）`,
  factorValue: 0.0004,
  providerName: TEPCO,
  providerNumber: 'A0269',
  factorType: 'adjusted',
  source: 'utility',
});
const tepcoBasic = factor({
  id: 'tepco-basic',
  name: `${TEPCO}（基礎）`,
  factorValue: 0.00045,
  providerName: TEPCO,
  providerNumber: 'A0269',
  factorType: 'basic',
  source: 'utility',
});

/** 廃棄物の標準係数（同梱の Scope3 代表原単位。scope='scope3' のため算定結果にカテゴリ5が付く） */
const wasteFactor = factor({
  id: 'waste-1',
  name: '産業廃棄物（焼却）',
  factorValue: 0.5,
  energyType: 'waste',
  scope: 'scope3',
  unit: 't-CO2/t',
});

// IDEA はライセンス上、実データを含めない（ダミー値のみ）。
const dummyProduct: IdeaProduct = {
  id: 'idea-1',
  ideaCode: '000000001mDMY',
  productName: 'ダミー製品',
  country: 'JPN',
  unit: 'kg',
};
const dummyDetail: IdeaProductDetail = {
  ...dummyProduct,
  organizationId: 'org',
  importId: 'imp',
  baseFlowAmount: '1',
  gwpValue: '1.5',
  importVersion: 'Ver.X 標準版',
};
const activeImport: IdeaImportRecord = {
  id: 'imp',
  version: 'Ver.X 標準版',
  releaseDate: null,
  gwpModel: 'GWP100',
  citationText: '',
  fileName: 'idea-dummy.xlsx',
  status: 'completed',
  rowCount: 1,
  isActive: true,
  unmappedRecordCount: 0,
  skippedRowCount: 0,
  errorMessage: null,
  createdAt: '2025-01-01T00:00:00Z',
};

type Scope12InitialValues = Extract<ActivityEntryInitialValues, { kind: 'scope12' }>;

/** 編集（Scope1/2・電気・2024-11）の初期値。 */
const editScope12 = (overrides: Partial<Scope12InitialValues> = {}): ActivityEntryInitialValues => ({
  kind: 'scope12',
  locationId: OSAKA.id,
  locationName: OSAKA.name,
  energyType: 'electricity',
  unit: 'kWh',
  targetMonth: '2024-11',
  amount: '1000',
  note: '',
  emissionFactorId: null,
  ...overrides,
});

// ---- 画面上の文言 ----

const LOADING_TEXT = '排出係数を取得しています...';
const CATEGORY_GROUP_LABELS = [
  '供給事業者別係数（電気・都市ガス・熱）',
  '標準係数（燃料・廃棄物・出張・通勤）',
  'IDEA 原単位（Scope 3 積上げ・カテゴリ1〜15）',
];
const SCOPE3_FACTOR_MISSING = '参照していた係数が削除されています。製品を再選択してください';

// ---- ヘルパー ----

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** 解決済みの Promise（モックの戻り値など）による state 更新を act 内で反映する。 */
const flush = () => act(async () => {});

/** 非同期ハンドラ（保存など）を持つ要素のクリック。await 後の続き（setState）も act 内に収める。 */
const clickAsync = (element: Element) =>
  act(async () => {
    (element as HTMLElement).click();
  });

/** 制御された <select> の値を変える（React の value 追跡を迂回してネイティブ setter → change）。 */
const setSelectValue = (select: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

/** 制御された <textarea> へ入力する（setInputValue の textarea 版）。 */
const setTextareaValue = (textarea: HTMLTextAreaElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const q = <T extends Element = HTMLElement>(container: HTMLElement, selector: string): T => {
  const element = container.querySelector<T>(selector);
  expect(element, `要素が見つかりません: ${selector}`).not.toBeNull();
  return element!;
};

const categorySelect = (container: HTMLElement) => q<HTMLSelectElement>(container, '#manual-category-select');
const monthInput = (container: HTMLElement) => q<HTMLInputElement>(container, '#manual-target-month');
const amountInput = (container: HTMLElement) => q<HTMLInputElement>(container, '#manual-amount-input');
const noteInput = (container: HTMLElement) => q<HTMLTextAreaElement>(container, '#manual-note-input');
const previewButton = (container: HTMLElement) => q<HTMLButtonElement>(container, '#manual-preview-button');
const chipText = (container: HTMLElement) =>
  q(container, '[data-testid="manual-factor-source-chip"]').textContent;
const unitText = (container: HTMLElement) => q(container, '[data-testid="manual-unit-display"]').textContent;
const factorDetailText = (container: HTMLElement) =>
  q(container, '[data-testid="manual-factor-detail"]').textContent ?? '';
/** 計算結果ブロックの末尾（太字の推定排出量 '5.5 t-CO2e' など）。 */
const resultEmissionsText = (container: HTMLElement) =>
  q(container, '[data-testid="manual-calculation-result"]').lastElementChild?.textContent;
const alertText = (container: HTMLElement) => q(container, '[role="alert"]').textContent ?? '';
const modal = (container: HTMLElement) => container.querySelector('.modal-content');

const countText = (container: HTMLElement, text: string): number =>
  (container.textContent ?? '').split(text).length - 1;

const optgroupLabels = (container: HTMLElement, selector = 'optgroup'): string[] =>
  [...container.querySelectorAll<HTMLOptGroupElement>(`#manual-category-select ${selector}`)].map(
    (group) => group.label,
  );

const findButton = (container: HTMLElement, text: string): HTMLButtonElement => {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(button, `ボタンが見つかりません: ${text}`).toBeDefined();
  return button!;
};

/** SearchableSelect を開いて、ラベルが prefix で始まる候補をクリックする。 */
const chooseOption = (container: HTMLElement, inputId: string, labelPrefix: string): void => {
  focusElement(q<HTMLInputElement>(container, `#${inputId}`));
  const option = [...container.querySelectorAll<HTMLButtonElement>('[role="option"] button')].find(
    (button) => (button.textContent ?? '').startsWith(labelPrefix),
  );
  expect(option, `候補が見つかりません: ${labelPrefix}`).toBeDefined();
  click(option!);
};

const openPreview = (container: HTMLElement): HTMLElement => {
  click(previewButton(container));
  return q(container, '.modal-content');
};

/** プレビューモーダルの行（ラベル + 値 + 補足）のテキスト。 */
const previewRowText = (container: HTMLElement, label: string): string => {
  const labelSpan = [...q(container, '.modal-content').querySelectorAll('span')].find(
    (span) => span.textContent === label,
  );
  expect(labelSpan, `プレビュー行が見つかりません: ${label}`).toBeDefined();
  return labelSpan!.parentElement?.textContent ?? '';
};

const saveFromPreview = (container: HTMLElement) => clickAsync(q(container, '#manual-save-button'));

/** 製品検索の debounce（setTimeout 300ms）を進めるための fake timers。Date も固定日時から進める。 */
const useSearchTimers = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
};

let mounted: RenderResult | null = null;

const renderForm = (props: Partial<ActivityEntryFormProps> = {}) => {
  const onSave = vi.fn<ActivityEntryFormProps['onSave']>().mockResolvedValue(undefined);
  const allProps: ActivityEntryFormProps = { locations: [OSAKA], onSave, ...props };
  const result = render(<ActivityEntryForm {...allProps} />);
  mounted = result;
  return {
    container: result.container,
    onSave: allProps.onSave as ReturnType<typeof vi.fn<ActivityEntryFormProps['onSave']>>,
    props: allProps,
    rerender: () => result.rerender(<ActivityEntryForm {...allProps} />),
  };
};

beforeAll(() => {
  // jsdom は scrollIntoView（レイアウト依存 API）を実装していないため no-op で補う。
  Element.prototype.scrollIntoView ??= () => {};
});

describe('ActivityEntryForm', () => {
  beforeEach(() => {
    vi.setSystemTime(FIXED_NOW);
    Object.assign(fiscalYearMock, {
      fiscalYearId: 'fy2024',
      fiscalYear: '2024',
      fiscalYears: [FY2024],
      isLoading: false,
    });
    fiscalYearMock.setFiscalYearId.mockReset();
    vi.mocked(getActiveScope12Factors).mockReset().mockResolvedValue([national]);
    vi.mocked(getProviderFactors).mockReset().mockResolvedValue([]);
    vi.mocked(fetchIdeaImportOverview)
      .mockReset()
      .mockResolvedValue({ active: activeImport, latest: activeImport });
    vi.mocked(searchIdeaProducts).mockReset().mockResolvedValue([]);
    vi.mocked(getIdeaProductDetail).mockReset().mockResolvedValue(null);
    // 既定は「積上げを採用中」＝注記なし。direct の注記は専用テストで切り替える。
    vi.mocked(getScope3CategoryMethod).mockReset().mockResolvedValue('calculated');
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('新規・電気: 係数取得中はプレビュー不可、取得後は代替値で概算しプレビューから保存できる', async () => {
    const yearLoad = deferred<CandidateFactorRow[]>();
    const providerLoad = deferred<CandidateFactorRow[]>();
    vi.mocked(getActiveScope12Factors).mockReturnValue(yearLoad.promise);
    vi.mocked(getProviderFactors).mockReturnValue(providerLoad.promise);
    const { container, onSave } = renderForm();

    expect(categorySelect(container).value).toBe('energy:electricity');
    expect(optgroupLabels(container)).toEqual(CATEGORY_GROUP_LABELS);
    expect(chipText(container)).toBe('供給事業者別係数');
    expect(countText(container, LOADING_TEXT)).toBe(1);
    expect(previewButton(container).disabled).toBe(true);
    // 対象年度が未公表のときに直近の過年度を暫定適用するため、取得はフォールバック年度も含む。
    expect(getActiveScope12Factors).toHaveBeenCalledWith([2023, 2024]);
    expect(getProviderFactors).toHaveBeenCalledWith('electricity', 2024);

    await act(async () => {
      yearLoad.resolve([national]);
      providerLoad.resolve([]);
    });

    expect(countText(container, LOADING_TEXT)).toBe(0);
    expect(previewButton(container).disabled).toBe(false);
    const factorSelect = q<HTMLSelectElement>(container, '#manual-factor-select');
    expect(factorSelect.value).toBe('national');
    expect([...factorSelect.options].some((option) => option.textContent?.endsWith('・自動選択'))).toBe(true);

    setInputValue(monthInput(container), '2024-11');
    setInputValue(amountInput(container), '10000');
    expect(resultEmissionsText(container)).toBe('5.5 t-CO2e');

    const preview = openPreview(container);
    expect(preview.querySelector('h2')?.textContent).toBe('入力内容の確認');
    expect(preview.textContent).toContain('t-CO2e');
    expect(previewRowText(container, '係数の参照方式')).toContain('供給事業者別係数（供給事業者未選択のため代替値）');

    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      kind: 'scope12',
      input: {
        locationId: 'loc-1',
        energyType: 'electricity',
        amount: 10000,
        unit: 'kWh',
        periodStart: '2024-11-01',
        periodEnd: '2024-11-30',
        note: null,
        emissionFactorId: 'national',
      },
    });
    // 保存後は続けて入力しやすいよう、活動量だけ空にしてカテゴリ等は保持する。
    expect(modal(container)).toBeNull();
    expect(amountInput(container).value).toBe('');
    expect(categorySelect(container).value).toBe('energy:electricity');
  });

  it('会計年度マスタが未確定の間は係数を取得せず、確定後に1回だけ取得する', async () => {
    Object.assign(fiscalYearMock, { fiscalYears: [], isLoading: true });
    const { container, rerender } = renderForm();

    expect(getActiveScope12Factors).not.toHaveBeenCalled();
    expect(countText(container, LOADING_TEXT)).toBe(1);
    expect(previewButton(container).disabled).toBe(true);

    Object.assign(fiscalYearMock, { fiscalYears: [FY2024] });
    rerender();

    expect(getActiveScope12Factors).toHaveBeenCalledTimes(1);
    // 対象年度が未公表のときに直近の過年度を暫定適用するため、取得はフォールバック年度も含む。
    expect(getActiveScope12Factors).toHaveBeenCalledWith([2023, 2024]);
    await flush();
    expect(countText(container, LOADING_TEXT)).toBe(0);
    expect(previewButton(container).disabled).toBe(false);
  });

  it('カテゴリ切替: 燃料は標準係数、Scope3 は IDEA 原単位に切り替わり、Scope3 の間は係数を再取得しない', async () => {
    const { container } = renderForm();
    await flush();
    expect(getActiveScope12Factors).toHaveBeenCalledTimes(1);

    setSelectValue(categorySelect(container), 'energy:fuel');
    expect(chipText(container)).toBe('標準係数');
    expect(unitText(container)).toBe('L');
    expect(container.querySelector('#manual-factor-type-select')).toBeNull();
    expect(container.querySelector('#manual-provider-select')).toBeNull();

    setSelectValue(categorySelect(container), 'scope3:1');
    expect(chipText(container)).toBe('IDEA 原単位');
    expect(container.querySelector('#manual-product-select')).not.toBeNull();
    expect(unitText(container)).toBe('—');
    expect(container.textContent).toContain('月次 × 製品で数量を合算した集約入力');
    expect(container.textContent).not.toContain('排出係数を取得しています');

    await flush();
    expect(getActiveScope12Factors).toHaveBeenCalledTimes(1);
  });

  it('供給事業者を選ぶとその係数が適用される（事業者リスト取得中は計算方法・事業者の選択が無効）', async () => {
    const providerLoad = deferred<CandidateFactorRow[]>();
    vi.mocked(getProviderFactors).mockReturnValue(providerLoad.promise);
    const { container, onSave } = renderForm();
    await flush(); // 標準係数は取得済み、事業者リストは取得中

    const factorTypeSelect = q<HTMLSelectElement>(container, '#manual-factor-type-select');
    const providerInput = q<HTMLInputElement>(container, '#manual-provider-select');
    expect(factorTypeSelect.disabled).toBe(true);
    expect(providerInput.disabled).toBe(true);
    expect(providerInput.placeholder).toBe('事業者リストを取得中...');
    // 取得中でも代替値の候補は出ており、E2E の同期文言は出さない。
    expect(container.querySelector('#manual-factor-select')).not.toBeNull();
    expect(countText(container, LOADING_TEXT)).toBe(0);

    await act(async () => {
      providerLoad.resolve([tepcoAdjusted, tepcoBasic]);
    });
    expect(factorTypeSelect.disabled).toBe(false);
    expect(providerInput.disabled).toBe(false);

    setInputValue(monthInput(container), '2024-11');
    chooseOption(container, 'manual-provider-select', TEPCO);

    expect(container.querySelector('#manual-factor-select')).toBeNull();
    expect(providerInput.value).toContain(TEPCO);
    expect(factorDetailText(container)).toContain(`事業者: ${TEPCO}`);
    expect(factorDetailText(container)).toContain('0.0004 t-CO2/kWh');

    setInputValue(amountInput(container), '10000');
    expect(resultEmissionsText(container)).toBe('4 t-CO2e');

    openPreview(container);
    expect(previewRowText(container, '係数の参照方式')).toBe('係数の参照方式供給事業者別係数');
    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      kind: 'scope12',
      input: {
        locationId: 'loc-1',
        energyType: 'electricity',
        amount: 10000,
        unit: 'kWh',
        periodStart: '2024-11-01',
        periodEnd: '2024-11-30',
        note: null,
        emissionFactorId: 'tepco-adjusted',
      },
    });
  });

  it('事業者係数が対象年度と前年度の 2 年分届いても、対象年度の行だけで事業者・メニューを組む', async () => {
    // 公式係数は年度ごとに同内容の行が生成されるため、対象年度が公表済みの通常運用では
    // フォールバック年度分の同じ事業者・メニューの行が一緒に届く（getProviderFactors は 2 年分を取る）。
    const previousYear = (row: CandidateFactorRow): CandidateFactorRow => ({
      ...row,
      id: `${row.id}-2023`,
      applicableYear: 2023,
      effectiveFrom: '2023-04-01',
      effectiveTo: '2024-03-31',
    });
    vi.mocked(getProviderFactors).mockResolvedValue([
      previousYear(tepcoAdjusted),
      tepcoAdjusted,
      previousYear(tepcoBasic),
      tepcoBasic,
    ]);
    const { container, onSave } = renderForm();
    await flush();

    setInputValue(monthInput(container), '2024-11');
    chooseOption(container, 'manual-provider-select', TEPCO);

    // メニューが 1 つの事業者なので、年度違いの行でメニュー選択が出たり重複したりしない。
    expect(container.querySelector('#manual-menu-select')).toBeNull();
    expect(factorDetailText(container)).toContain(`事業者: ${TEPCO}`);
    expect(container.textContent).not.toContain('暫定適用');

    setInputValue(amountInput(container), '10000');
    openPreview(container);
    await saveFromPreview(container);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      kind: 'scope12',
      input: { emissionFactorId: 'tepco-adjusted', periodStart: '2024-11-01' },
    });
  });

  it('編集（MWh の取込レコード）: 記録の単位を保持して概算・保存し、カテゴリを変えると標準単位になる', async () => {
    const onCancel = vi.fn();
    const { container, onSave } = renderForm({
      mode: 'edit',
      initialValues: editScope12({ unit: 'MWh', amount: '245.78' }),
      onCancel,
    });
    await flush();

    expect(unitText(container)).toBe('MWh');
    expect(container.textContent).toContain('標準単位「kWh」と異なります');
    // 245.78 MWh = 245,780 kWh × 0.00055 t-CO2/kWh = 135.179 t-CO2e
    expect(resultEmissionsText(container)).toBe('135.179 t-CO2e');

    setTextareaValue(noteInput(container), '取込データの修正');
    const preview = openPreview(container);
    expect(preview.querySelector('h2')?.textContent).toBe('変更内容の確認');
    expect(previewRowText(container, '活動量')).toContain('245.78 MWh');
    expect(previewRowText(container, '活動量')).toContain('記録の単位（取込データ）をそのまま保持します');
    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      kind: 'scope12',
      input: {
        locationId: 'loc-1',
        energyType: 'electricity',
        amount: 245.78,
        unit: 'MWh',
        periodStart: '2024-11-01',
        periodEnd: '2024-11-30',
        note: '取込データの修正',
        emissionFactorId: null,
      },
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    // カテゴリを変えると記録の単位ではなく新カテゴリの標準単位になる。
    setSelectValue(categorySelect(container), 'energy:city_gas');
    expect(unitText(container)).toBe('m³');
    expect(container.textContent).not.toContain('と異なります');
    // 編集では保存経路をまたぐ群（Scope3 積上げ）は選択不可。
    expect(optgroupLabels(container, 'optgroup[disabled]')).toEqual([CATEGORY_GROUP_LABELS[2]]);
  });

  it('編集（事業者係数を保存済み・未操作）: 事業者選択を復元し、触らずに保存しても月を変えても係数指定を維持する', async () => {
    vi.mocked(getProviderFactors).mockResolvedValue([tepcoAdjusted, tepcoBasic]);
    const { container, onSave } = renderForm({
      mode: 'edit',
      initialValues: editScope12({ emissionFactorId: 'tepco-adjusted' }),
      onCancel: vi.fn(),
    });
    await flush();

    expect(q<HTMLSelectElement>(container, '#manual-factor-type-select').value).toBe('adjusted');
    expect(q<HTMLInputElement>(container, '#manual-provider-select').value).toContain(TEPCO);
    expect(container.querySelector('#manual-factor-select')).toBeNull();
    expect(factorDetailText(container)).toContain(`事業者: ${TEPCO}`);
    expect(container.textContent).not.toContain('適用できません');

    openPreview(container);
    await saveFromPreview(container);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      kind: 'scope12',
      input: { emissionFactorId: 'tepco-adjusted', periodStart: '2024-11-01', periodEnd: '2024-11-30' },
    });

    // 対象年月を変えても（同一年度なら）復元した事業者選択は維持される。
    setInputValue(monthInput(container), '2024-12');
    expect(factorDetailText(container)).toContain(`事業者: ${TEPCO}`);
    openPreview(container);
    await saveFromPreview(container);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toMatchObject({
      kind: 'scope12',
      input: { emissionFactorId: 'tepco-adjusted', periodStart: '2024-12-01', periodEnd: '2024-12-31' },
    });
  });

  it('編集（事業者リストの取得失敗）: 判定不能の警告を出し、元の係数指定を維持して保存する', async () => {
    vi.mocked(getProviderFactors).mockRejectedValue(new Error('network'));
    const { container, onSave } = renderForm({
      mode: 'edit',
      initialValues: editScope12({ emissionFactorId: 'tepco-adjusted' }),
      onCancel: vi.fn(),
    });
    await flush();

    expect(container.textContent).toContain('事業者リストを取得できなかったため');
    expect(previewButton(container).disabled).toBe(false);

    openPreview(container);
    expect(previewRowText(container, '適用係数')).toContain('元の係数指定を維持');
    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ input: { emissionFactorId: 'tepco-adjusted' } });
  });

  it('編集（保存済み係数が有効期間外）: 適用不可を警告し、触らなければ係数指定はそのまま保存する', async () => {
    vi.mocked(getProviderFactors).mockResolvedValue([{ ...tepcoAdjusted, effectiveTo: '2024-10-31' }, tepcoBasic]);
    const { container, onSave } = renderForm({
      mode: 'edit',
      initialValues: editScope12({ emissionFactorId: 'tepco-adjusted' }),
      onCancel: vi.fn(),
    });
    await flush();

    expect(container.textContent).toContain('このレコードに保存されていた排出係数は');
    // 実際に適用されるのは自動選択された代替値（全国）。
    expect(factorDetailText(container)).toContain('地域: 全国');

    const preview = openPreview(container);
    expect(previewRowText(container, '適用係数')).toContain('保存されていた係数は適用できないため自動選択');
    expect(preview.textContent).toContain('上記の自動選択された係数で再計算されます');
    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ input: { emissionFactorId: 'tepco-adjusted' } });
  });

  it('IDEA（新規）: 製品を検索して選ぶと単位が自動設定され、原単位で概算して Scope3 として保存する', async () => {
    useSearchTimers();
    vi.mocked(searchIdeaProducts).mockResolvedValue([dummyProduct]);
    vi.mocked(getIdeaProductDetail).mockResolvedValue(dummyDetail);
    const { container, onSave } = renderForm();
    // 新規入力は既定カテゴリ（電気）でマウントされるため、この時点の1回だけ Scope1/2 の係数取得が走る。
    expect(getActiveScope12Factors).toHaveBeenCalledTimes(1);

    setSelectValue(categorySelect(container), 'scope3:1');
    await flush(); // 取込状況（active あり）
    expect(searchIdeaProducts).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300); // 検索の debounce
    });
    expect(searchIdeaProducts).toHaveBeenCalledWith('');

    chooseOption(container, 'manual-product-select', 'ダミー製品');
    await flush(); // 製品詳細
    expect(getIdeaProductDetail).toHaveBeenCalledWith('idea-1');
    expect(unitText(container)).toBe('kg');
    expect(factorDetailText(container)).toContain('製品: ダミー製品（JPN）');
    expect(factorDetailText(container)).toContain('原単位: 1.5 kg-CO2e/kg');
    expect(factorDetailText(container)).toContain('出典: AIST-IDEA Ver.X 標準版');

    setInputValue(monthInput(container), '2024-11');
    setInputValue(amountInput(container), '1000');
    // 1,000 kg × 1.5 kg-CO2e/kg = 1,500 kg-CO2e = 1.5 t-CO2e
    expect(resultEmissionsText(container)).toBe('1.5 t-CO2e');

    openPreview(container);
    // Scope 1・2 と同じ 8 行構成: 製品は「適用係数」行に出し、原単位と出典を補足に出す
    expect(previewRowText(container, '適用係数')).toContain('ダミー製品（JPN / kg）');
    expect(previewRowText(container, '適用係数')).toContain('原単位: 1.5 kg-CO2e/kg');
    expect(previewRowText(container, '係数の参照方式')).toBe('係数の参照方式IDEA 原単位');
    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      kind: 'scope3',
      input: {
        locationId: 'loc-1',
        scope3CategoryId: 1,
        ideaFactorId: 'idea-1',
        amount: 1000,
        unit: 'kg',
        periodStart: '2024-11-01',
        periodEnd: '2024-11-30',
        note: null,
      },
    });
    // Scope3 の間は Scope1/2 の係数を取得しない。
    expect(getActiveScope12Factors).toHaveBeenCalledTimes(1);
    expect(getProviderFactors).toHaveBeenCalledTimes(1);
  });

  it('IDEA 未取込: 案内を出して製品検索を無効化し、検索 API を呼ばない', async () => {
    useSearchTimers();
    vi.mocked(fetchIdeaImportOverview).mockResolvedValue({ active: null, latest: null });
    const { container } = renderForm();

    setSelectValue(categorySelect(container), 'scope3:1');
    await flush();

    expect(container.textContent).toContain('IDEAデータベースが未取込のため');
    const productInput = q<HTMLInputElement>(container, '#manual-product-select');
    expect(productInput.disabled).toBe(true);
    expect(productInput.placeholder).toBe('IDEAデータベースが未取込です');

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(searchIdeaProducts).not.toHaveBeenCalled();
  });

  it('編集（参照切れの Scope3 レコード）: 再選択を促し、そのままではプレビューできず、Scope1/2 群は選択不可', async () => {
    const { container, onSave } = renderForm({
      mode: 'edit',
      initialValues: {
        kind: 'scope3',
        locationId: OSAKA.id,
        locationName: OSAKA.name,
        scope3CategoryId: 1,
        ideaFactorId: null,
        targetMonth: '2024-11',
        amount: '100',
        note: '',
      },
      onCancel: vi.fn(),
    });
    await flush();

    expect(categorySelect(container).value).toBe('scope3:1');
    expect(countText(container, SCOPE3_FACTOR_MISSING)).toBe(1);
    expect(optgroupLabels(container, 'optgroup[disabled]')).toEqual([
      CATEGORY_GROUP_LABELS[0],
      CATEGORY_GROUP_LABELS[1],
    ]);

    click(previewButton(container));
    expect(modal(container)).toBeNull();
    expect(alertText(container)).toContain(SCOPE3_FACTOR_MISSING);
    expect(onSave).not.toHaveBeenCalled();
  });

  // 小数第 4 位以下は DB（numeric(15,3)）で 0.000 に丸まる。プレビューに非ゼロの概算を出してから 0 で保存されないよう、
  // 入力欄の直下で即座に知らせ、プレビュー・保存も止める。
  it('numeric(15,3) に収まらない活動量は概算を出さず、入力欄の直下とプレビュー時に文言を出す', async () => {
    const { container, onSave } = renderForm();
    await flush();
    setInputValue(monthInput(container), '2024-11');

    setInputValue(amountInput(container), '0.0004');
    expect(q(container, '[data-testid="manual-amount-error"]').textContent).toBe(
      '活動量は小数第3位までで入力してください。',
    );
    expect(container.querySelector('[data-testid="manual-calculation-result"]')).toBeNull();
    click(previewButton(container));
    expect(modal(container)).toBeNull();
    expect(alertText(container)).toContain('活動量は小数第3位までで入力してください。');

    setInputValue(amountInput(container), '1000000000000');
    expect(q(container, '[data-testid="manual-amount-error"]').textContent).toBe(
      '活動量は整数部12桁以内（999,999,999,999 以下）で入力してください。',
    );

    // 上限内に直せば文言が消えて概算が出る。
    setInputValue(amountInput(container), '0.004');
    expect(container.querySelector('[data-testid="manual-amount-error"]')).toBeNull();
    expect(resultEmissionsText(container)).toBeDefined();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('保存失敗（Error）: message をフォーム内の alert に表示し、入力は消さない', async () => {
    const duplicateMessage = '『大阪支社』の電気・2024年11月 の活動量は既に登録済みです。';
    const { container, onSave } = renderForm();
    await flush();
    setInputValue(monthInput(container), '2024-11');
    setInputValue(amountInput(container), '10000');
    onSave.mockRejectedValueOnce(new Error(duplicateMessage));

    openPreview(container);
    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(alertText(container)).toContain(duplicateMessage);
    // 失敗時は入力を消さない（修正して再保存できる）。
    expect(amountInput(container).value).toBe('10000');
  });

  it('保存失敗（Error 以外）: 経路・モードに応じた既定の文言を表示する', async () => {
    const { container, onSave } = renderForm();
    await flush();
    setInputValue(amountInput(container), '10000');
    onSave.mockRejectedValueOnce('boom');

    openPreview(container);
    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(alertText(container)).toContain('活動量レコードの登録に失敗しました');
  });

  // onSave の reject（重複登録エラーなど。DataInput.handleManualSave はそのまま投げる）は Card 内の alert に出す。
  // プレビューモーダル（.modal-overlay の全面スクリム）を開いたままだと alert が隠れるため、閉じることを固定する。
  it('保存失敗時はプレビューモーダルを閉じ、フォーム内のエラーを見せる', async () => {
    const { container, onSave } = renderForm();
    await flush();
    setInputValue(amountInput(container), '10000');
    onSave.mockRejectedValueOnce(new Error('保存に失敗しました'));

    openPreview(container);
    await saveFromPreview(container);

    expect(modal(container)).toBeNull();
    expect(alertText(container)).toContain('保存に失敗しました');
  });

  it('編集の削除は2段階: 1回目で確認表示に変わり、2回目で onDelete を呼ぶ', async () => {
    const onDelete = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const { container } = renderForm({
      mode: 'edit',
      initialValues: editScope12(),
      onCancel: vi.fn(),
      onDelete,
    });
    await flush();

    const deleteButton = findButton(container, 'この履歴を削除');
    click(deleteButton);
    expect(deleteButton.textContent?.trim()).toBe('もう一度押すと削除します');
    expect(onDelete).not.toHaveBeenCalled();

    click(deleteButton);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('編集（拠点が稼働中・一時停止でなくなった記録）: 案内を出して拠点と保存を止め、係数判定は先頭拠点で行う', async () => {
    const { container, onSave } = renderForm({
      mode: 'edit',
      initialValues: editScope12({ locationId: 'loc-closed', locationName: '旧工場' }),
      onCancel: vi.fn(),
    });
    await flush();

    expect(container.textContent).toContain('この記録の拠点「旧工場」は稼働中・一時停止ではないため、この記録は編集できません');
    expect(q<HTMLSelectElement>(container, '#manual-location-select').disabled).toBe(true);
    expect(previewButton(container).disabled).toBe(true);
    // 拠点未解決のまま「取得中」に見せない: 係数判定は選択肢の先頭拠点で行い、候補が表示される
    expect(countText(container, '事業者リストを取得中')).toBe(0);
    expect(q<HTMLSelectElement>(container, '#manual-factor-select').value).toBe('national');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('編集（事業者係数を保存済み）: 事業者リスト取得中は対象年月・拠点を変更できず、取得後に変更できる', async () => {
    const providerLoad = deferred<CandidateFactorRow[]>();
    vi.mocked(getProviderFactors).mockReturnValue(providerLoad.promise);
    const { container } = renderForm({
      mode: 'edit',
      initialValues: editScope12({ emissionFactorId: 'tepco-adjusted' }),
      onCancel: vi.fn(),
    });
    await flush();

    // 復元（事業者リストからの派生）が確定するまで年度をまたぐ変更で復元が飛ばないよう止める
    expect(monthInput(container).disabled).toBe(true);
    expect(q<HTMLSelectElement>(container, '#manual-location-select').disabled).toBe(true);

    await act(async () => {
      providerLoad.resolve([tepcoAdjusted, tepcoBasic]);
    });
    expect(monthInput(container).disabled).toBe(false);
    expect(q<HTMLSelectElement>(container, '#manual-location-select').disabled).toBe(false);
    expect(q<HTMLSelectElement>(container, '#manual-factor-type-select').value).toBe('adjusted');
  });

  // 標準係数の廃棄物・出張・通勤も IDEA 積上げも emission_results（scope3）側に載るため、
  // カテゴリの算定方法が direct（既定）のままだとダッシュボードの Scope 3 合計に採用されない。
  it('廃棄物: カテゴリ5が直接入力を採用中なら、反映されない旨と Scope分析画面への導線を出す', async () => {
    vi.mocked(getActiveScope12Factors).mockResolvedValue([national, wasteFactor]);
    vi.mocked(getScope3CategoryMethod).mockResolvedValue('direct');
    const { container } = renderForm();
    await flush();

    // 既定カテゴリ（電気＝scope2 の係数）は Scope 3 に載らないため方式も引かない。
    expect(container.querySelector('[data-testid="manual-scope3-method-notice"]')).toBeNull();
    expect(getScope3CategoryMethod).not.toHaveBeenCalled();

    setSelectValue(categorySelect(container), 'energy:waste');
    await flush();

    // 年度は対象年月（既定＝当月 2025-01）が属する会計年度で引く。
    expect(getScope3CategoryMethod).toHaveBeenCalledWith('fy2024:5');
    const notice = q(container, '[data-testid="manual-scope3-method-notice"]');
    expect(notice.textContent).toContain('カテゴリ5「事業から出る廃棄物」');
    expect(notice.textContent).toContain('ダッシュボードの Scope 3 合計には反映されません');
    // 方式はカテゴリ×年度で持つため、どの年度の方式かを注記と導線の両方に出す。
    expect(notice.textContent).toContain('2024年度');
    const link = q<HTMLAnchorElement>(notice, 'a');
    // 新しいタブで開いても年度が届くよう、年度は URL で運ぶ。
    expect(link.getAttribute('href')).toBe('/scope-analysis?fy=fy2024');
    expect(link.textContent).toContain('2024年度');
  });

  // 過年度の一括入力（選択年度と対象年月の帰属年度が違う）で、導線の先が選択年度のままだと
  // 別年度のカテゴリを切替えてしまい「切替えたのに反映されない」ように見える。
  // 年度は URL で運ぶ（新しいタブで開かれても届く）のに加え、同一タブの遷移では
  // 画面を開く前に選択年度も合わせる。
  it('廃棄物: 選択年度と対象年月の帰属年度が違うとき、導線は記録の年度を URL で運び、選択年度も切替える', async () => {
    Object.assign(fiscalYearMock, {
      fiscalYearId: 'fy2025',
      fiscalYear: '2025',
      fiscalYears: [FY2024, FY2025],
    });
    vi.mocked(getActiveScope12Factors).mockResolvedValue([national, wasteFactor]);
    vi.mocked(getScope3CategoryMethod).mockResolvedValue('direct');
    const { container } = renderForm();
    await flush();

    setSelectValue(categorySelect(container), 'energy:waste');
    await flush();

    // 判定・注記は対象年月（既定＝当月 2025-01）の帰属年度 2024 で行う（選択中の 2025 ではない）。
    expect(getScope3CategoryMethod).toHaveBeenCalledWith('fy2024:5');
    const notice = q(container, '[data-testid="manual-scope3-method-notice"]');
    expect(notice.textContent).toContain('2024年度');
    expect(notice.textContent).not.toContain('2025年度');

    const link = q<HTMLAnchorElement>(notice, 'a');
    expect(link.getAttribute('href')).toBe('/scope-analysis?fy=fy2024');

    await act(async () => {
      click(link);
    });

    expect(fiscalYearMock.setFiscalYearId).toHaveBeenCalledWith('fy2024');
  });

  it('廃棄物: カテゴリ5が積上げを採用中なら注記を出さない', async () => {
    vi.mocked(getActiveScope12Factors).mockResolvedValue([national, wasteFactor]);
    vi.mocked(getScope3CategoryMethod).mockResolvedValue('calculated');
    const { container } = renderForm();
    await flush();

    setSelectValue(categorySelect(container), 'energy:waste');
    await flush();

    expect(getScope3CategoryMethod).toHaveBeenCalledWith('fy2024:5');
    expect(container.querySelector('[data-testid="manual-scope3-method-notice"]')).toBeNull();
  });

  it('拠点が無い場合は案内を出し、係数・活動量のセクションを出さずプレビューも無効にする', async () => {
    const { container } = renderForm({ locations: [] });
    await flush();

    expect(container.textContent).toContain('データ入力に使用できる拠点がありません');
    expect(container.querySelector('[data-testid="manual-factor-section"]')).toBeNull();
    expect(container.querySelector('#manual-amount-input')).toBeNull();
    expect(previewButton(container).disabled).toBe(true);
  });
});
