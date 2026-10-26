// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, focusElement, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import {
  fetchIdeaImportForFiscalYear,
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
import {
  getRecordEvidence,
  unlinkEvidence,
  uploadEvidenceFile,
} from '@/features/activity-evidence/services/evidenceClient';
import type { EvidenceFile } from '@/features/activity-evidence/types';
import type {
  ActivityEntryInitialValues,
  ManualEntryLocationOption,
  SavedManualActivityRecord,
} from '../../types';
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
  fetchIdeaImportForFiscalYear: vi.fn(),
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

// 帳票の欄の I/O（Storage・紐づけ）。WebP への変換はしない（このブラウザに覚えた選択は既定で off）。
vi.mock('@/features/activity-evidence/services/evidenceClient', () => ({
  uploadEvidenceFile: vi.fn(),
  getRecordEvidence: vi.fn(async () => []),
  linkEvidence: vi.fn(),
  unlinkEvidence: vi.fn(),
  openEvidenceFile: vi.fn(),
}));

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

/** 前年度。対象年月プルダウンの年度切替（過年度入力）を作るために使う。 */
const FY2023: FiscalYearOption = {
  id: 'fy2023',
  label: '2023年度',
  year: '2023',
  startDate: '2023-04-01',
  endDate: '2024-03-31',
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

/** IME の composition イベントを発火する（変換の開始・確定を再現する）。 */
const fireComposition = (input: HTMLInputElement, type: 'compositionstart' | 'compositionend'): void => {
  act(() => {
    input.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
  });
};

const q = <T extends Element = HTMLElement>(container: HTMLElement, selector: string): T => {
  const element = container.querySelector<T>(selector);
  expect(element, `要素が見つかりません: ${selector}`).not.toBeNull();
  return element!;
};

const categorySelect = (container: HTMLElement) => q<HTMLSelectElement>(container, '#manual-category-select');
/** 対象年月の「月」セレクト（算定期間連動プルダウン。年度未登録時だけネイティブ month 入力になる）。 */
const monthInput = (container: HTMLElement) => q<HTMLSelectElement>(container, '#manual-target-month');
const monthYearSelect = (container: HTMLElement) =>
  q<HTMLSelectElement>(container, '#manual-target-month-year');
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
    /** props の一部を差し替えて再レンダリングする（親が履歴を更新したときなどを再現する）。 */
    rerender: (overrides: Partial<ActivityEntryFormProps> = {}) =>
      result.rerender(<ActivityEntryForm {...allProps} {...overrides} />),
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
    // 既定は年度に版を割り当てていない（有効な版から検索する）
    vi.mocked(fetchIdeaImportForFiscalYear).mockReset().mockResolvedValue(null);
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

    setSelectValue(monthInput(container), '2024-11');
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
    // 対象年月は翌月へ自動で送る（同一拠点の連続入力を「数量を打って保存」の繰り返しにする）。
    expect(monthInput(container).value).toBe('2024-12');
  });

  it('当月で保存したときは対象年月を未来月へ送らない', async () => {
    const { container, onSave } = renderForm();
    await flush();

    // 既定の対象年月は当月（2025-01）。
    expect(monthInput(container).value).toBe('2025-01');
    setInputValue(amountInput(container), '100');
    openPreview(container);
    await saveFromPreview(container);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(monthInput(container).value).toBe('2025-01');
  });

  // 翌年度が未登録のまま年度末の月を保存したとき、「算定期間外」の月へ進めて係数の無い入力を続けさせない。
  describe('年度末の保存後の対象年月', () => {
    // 1月始まりの会計年度。年度末（2024-12）が当月（2025-01）以前になり、係数の有効期間にも収まる。
    const CAL2024: FiscalYearOption = {
      id: 'cal2024',
      label: '2024年（1月始まり）',
      year: '2024',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    };
    const CAL2025: FiscalYearOption = {
      id: 'cal2025',
      label: '2025年（1月始まり）',
      year: '2025',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    };

    const saveYearEnd = async (container: HTMLElement) => {
      setSelectValue(monthYearSelect(container), 'cal2024');
      setSelectValue(monthInput(container), '2024-12');
      // 年度が変わると係数を取り直すため、取得完了（プレビューの有効化）を待つ。
      await flush();
      setInputValue(amountInput(container), '100');
      openPreview(container);
      await saveFromPreview(container);
    };

    it('翌年度が未登録なら対象年月を送らず年度末の月に留まる', async () => {
      Object.assign(fiscalYearMock, { fiscalYears: [CAL2024] });
      const { container, onSave } = renderForm();
      await flush();

      await saveYearEnd(container);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(monthInput(container).value).toBe('2024-12');
      expect(monthYearSelect(container).value).toBe('cal2024');
    });

    it('翌年度が登録済みなら翌年度の最初の月へ送る', async () => {
      Object.assign(fiscalYearMock, { fiscalYears: [CAL2025, CAL2024] });
      const { container, onSave } = renderForm();
      await flush();

      await saveYearEnd(container);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(monthInput(container).value).toBe('2025-01');
      expect(monthYearSelect(container).value).toBe('cal2025');
    });
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

    setSelectValue(monthInput(container), '2024-11');
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

    setSelectValue(monthInput(container), '2024-11');
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
    setSelectValue(monthInput(container), '2024-12');
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
    // 年度に版を割り当てていないので、有効な版から検索する（importId = null）
    expect(searchIdeaProducts).toHaveBeenCalledWith('', { importId: null });
    expect(container.textContent).toContain('Ver.X 標準版（有効な版）から検索します');

    chooseOption(container, 'manual-product-select', 'ダミー製品');
    await flush(); // 製品詳細
    expect(getIdeaProductDetail).toHaveBeenCalledWith('idea-1');
    expect(unitText(container)).toBe('kg');
    expect(factorDetailText(container)).toContain('製品: ダミー製品（JPN）');
    expect(factorDetailText(container)).toContain('原単位: 1.5 kg-CO2e/kg');
    expect(factorDetailText(container)).toContain('出典: AIST-IDEA Ver.X 標準版');

    setSelectValue(monthInput(container), '2024-11');
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

  it('IDEA（年度に版を割り当て）: 対象年月の年度に割り当てた版から検索し、別の版の製品を選ぶと選び直しを促す', async () => {
    useSearchTimers();
    vi.mocked(fetchIdeaImportForFiscalYear).mockResolvedValue({ importId: 'imp-2023', version: 'Ver.3.4' });
    // 割り当てた版とは別の版（有効な版 imp）の製品を選んだ状態を作る
    vi.mocked(searchIdeaProducts).mockResolvedValue([dummyProduct]);
    vi.mocked(getIdeaProductDetail).mockResolvedValue(dummyDetail);
    const { container } = renderForm();

    setSelectValue(categorySelect(container), 'scope3:1');
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // 対象年月（既定の当月 2025-01）が属する 2024年度に割り当てた版から検索する
    expect(fetchIdeaImportForFiscalYear).toHaveBeenCalledWith('fy2024');
    expect(searchIdeaProducts).toHaveBeenCalledWith('', { importId: 'imp-2023' });
    expect(container.textContent).toContain('Ver.3.4（この年度に割り当てた版）から検索します');

    chooseOption(container, 'manual-product-select', 'ダミー製品');
    await flush();
    expect(container.textContent).toContain('選択中の製品は Ver.X 標準版 の係数です');
    expect(container.textContent).toContain('製品を選び直してください');
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
    setSelectValue(monthInput(container), '2024-11');

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

  // 日本語IMEがオンのままだと全角数字が DECIMAL_PATTERN に合わず、controlled input が
  // 変換中の値を毎回巻き戻して「何も入力できない」状態になっていた。変換中は見たまま表示し、
  // 確定時に全角→半角へ正規化して受け付けることを固定する。
  describe('活動量入力の IME 対応と正規化', () => {
    it('IME 変換中は入力をそのまま表示し、確定時に全角数字を半角へ正規化して受け付ける', async () => {
      const { container } = renderForm();
      await flush();
      const input = amountInput(container);

      fireComposition(input, 'compositionstart');
      setInputValue(input, '１２３４５');
      // 変換中に巻き戻すと composition が壊れるため、そのまま表示する。
      expect(input.value).toBe('１２３４５');

      fireComposition(input, 'compositionend');
      expect(input.value).toBe('12345');
      expect(container.querySelector('[data-testid="manual-amount-rejected"]')).toBeNull();
    });

    it('IME を使わない貼り付けでもカンマ・全角混じりを正規化して受け付ける', async () => {
      const { container } = renderForm();
      await flush();
      setInputValue(amountInput(container), '12,345');
      expect(amountInput(container).value).toBe('12345');
      setInputValue(amountInput(container), '１，０００．５');
      expect(amountInput(container).value).toBe('1000.5');
    });

    it('正規化しても数字にならない確定入力は直前の値に戻し、理由を表示する', async () => {
      const { container } = renderForm();
      await flush();
      const input = amountInput(container);
      setInputValue(input, '123');

      fireComposition(input, 'compositionstart');
      setInputValue(input, '123とうきょう');
      fireComposition(input, 'compositionend');

      expect(input.value).toBe('123');
      expect(q(container, '[data-testid="manual-amount-rejected"]').textContent).toBe(
        '活動量は数字と小数点のみ入力できます。',
      );

      // 数字を入力し直せば案内は消える。
      setInputValue(input, '1234');
      expect(input.value).toBe('1234');
      expect(container.querySelector('[data-testid="manual-amount-rejected"]')).toBeNull();
    });

    // 保存成功で活動量を空にした直後に数字以外を入れると、戻す先が保存前の値のままだったため
    // 古い活動量が復活し、翌月分として再保存できてしまっていた。空欄のまま理由だけ出すことを固定する。
    it('保存成功で空になった欄に数字以外を入れても、保存前の活動量は復活しない', async () => {
      const { container, onSave } = renderForm();
      await flush();
      setInputValue(amountInput(container), '100');
      openPreview(container);
      await saveFromPreview(container);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(amountInput(container).value).toBe('');

      // 通常入力（IME を使わない経路）。
      setInputValue(amountInput(container), 'a');
      expect(amountInput(container).value).toBe('');
      expect(q(container, '[data-testid="manual-amount-rejected"]').textContent).toBe(
        '活動量は数字と小数点のみ入力できます。',
      );

      // IME 変換を確定する経路でも、変換開始時点の空欄に戻す。
      const input = amountInput(container);
      fireComposition(input, 'compositionstart');
      setInputValue(input, 'あ');
      fireComposition(input, 'compositionend');
      expect(input.value).toBe('');
      expect(q(container, '[data-testid="manual-amount-rejected"]')).not.toBeNull();
    });
  });

  // 休止拠点・契約のみの月など、実績ゼロを「入力漏れ」と区別して記録できるようにする。
  // タイプミス（入力し忘れたまま確定）を防ぐため、プレビューに確認表示を挟んでから保存する。
  it('活動量 0 は排出量 0 で概算され、プレビューの確認表示を経て保存できる', async () => {
    const { container, onSave } = renderForm();
    await flush();
    setSelectValue(monthInput(container), '2024-11');

    // 0 より大きい値では確認表示を出さない。
    setInputValue(amountInput(container), '10000');
    const nonZeroPreview = openPreview(container);
    expect(nonZeroPreview.textContent).not.toContain('活動量 0 で保存します');
    click(findButton(container, 'キャンセル'));

    setInputValue(amountInput(container), '0');
    expect(container.querySelector('[data-testid="manual-amount-error"]')).toBeNull();
    expect(resultEmissionsText(container)).toBe('0 t-CO2e');

    const preview = openPreview(container);
    expect(previewRowText(container, '活動量')).toContain('0 kWh');
    expect(previewRowText(container, '推定排出量')).toContain('0 t-CO2e');
    expect(preview.textContent).toContain(
      '活動量 0 で保存します。実績ゼロの記録として排出量 0 で算定されます。入力漏れでないかご確認ください。',
    );

    await saveFromPreview(container);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      kind: 'scope12',
      input: expect.objectContaining({ amount: 0, unit: 'kWh' }),
    });
  });

  it('保存失敗（Error）: message をフォーム内の alert に表示し、入力は消さない', async () => {
    const duplicateMessage = '『大阪支社』の電気・2024年11月 の活動量は既に登録済みです。';
    const { container, onSave } = renderForm();
    await flush();
    setSelectValue(monthInput(container), '2024-11');
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

  // ---- 対象年月の算定期間連動プルダウン ----

  it('対象年月: 選択中の算定期間の12ヶ月を「2024年11月」表記で出し、未来月は選べない', async () => {
    const { container } = renderForm();
    await flush();

    expect(monthYearSelect(container).value).toBe('fy2024');
    const options = [...monthInput(container).options];
    expect(options.map((option) => option.value)).toEqual([
      '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09',
      '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03',
    ]);
    expect(options[7].textContent).toBe('2024年11月');
    // 当月（2025-01）までは選べ、未来月（2025-02 以降）は見せたうえで選べない。
    expect(options.filter((option) => option.disabled).map((option) => option.value)).toEqual([
      '2025-02', '2025-03',
    ]);
    expect(monthInput(container).value).toBe('2025-01');
  });

  it('対象年月: 年度を切替えると同じ月を保ったまま年度だけ差し替える（未来年度は選択肢に出さない）', async () => {
    Object.assign(fiscalYearMock, { fiscalYears: [FY2025, FY2024, FY2023] });
    const { container } = renderForm();
    await flush();

    // FY2025（2025-04〜2026-03）は全月が未来で選べないため年度の選択肢にも出さない。
    expect([...monthYearSelect(container).options].map((option) => option.value)).toEqual([
      'fy2024', 'fy2023',
    ]);

    setSelectValue(monthYearSelect(container), 'fy2023');
    // 当月 2025-01 の「1月」を保ったまま 2023 年度の 2024-01 へ。
    expect(monthInput(container).value).toBe('2024-01');
    expect(monthYearSelect(container).value).toBe('fy2023');

    // 2023 年度で 6 月（2023-06）を選んでから 2024 年度へ戻すと 2024-06 になる。
    setSelectValue(monthInput(container), '2023-06');
    setSelectValue(monthYearSelect(container), 'fy2024');
    expect(monthInput(container).value).toBe('2024-06');
  });

  it('編集: どの算定期間にも属さない年月の記録は「算定期間外」の選択肢として表示を保つ', async () => {
    const { container } = renderForm({
      mode: 'edit',
      initialValues: editScope12({ targetMonth: '2019-05' }),
      onCancel: vi.fn(),
    });
    await flush();

    expect(monthYearSelect(container).value).toBe('out-of-range');
    const options = [...monthInput(container).options];
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe('2019-05');
    expect(options[0].textContent).toBe('2019年5月（算定期間外）');

    // 実在の年度へ切替えると、その年度で選べる月に乗り換えられる（期間外へは戻れない）。
    setSelectValue(monthYearSelect(container), 'fy2024');
    expect(monthInput(container).value).toBe('2024-05');
    expect([...monthYearSelect(container).options].every((option) => option.value !== 'out-of-range')).toBe(
      true,
    );
  });

  it('年度マスタが空の組織はネイティブの月入力へフォールバックする', async () => {
    Object.assign(fiscalYearMock, { fiscalYears: [], isLoading: false });
    const { container } = renderForm();
    await flush();

    const input = q<HTMLInputElement>(container, '#manual-target-month');
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('month');
    expect(container.querySelector('#manual-target-month-year')).toBeNull();
  });

  it('拠点が無い場合は案内を出し、係数・活動量のセクションを出さずプレビューも無効にする', async () => {
    const { container } = renderForm({ locations: [] });
    await flush();

    expect(container.textContent).toContain('データ入力に使用できる拠点がありません');
    expect(container.querySelector('[data-testid="manual-factor-section"]')).toBeNull();
    expect(container.querySelector('#manual-amount-input')).toBeNull();
    expect(previewButton(container).disabled).toBe(true);
  });

  // ---- 重複の事前警告: 拠点・カテゴリ・対象年月が揃った時点で入力済みを知らせる ----

  const duplicateWarning = (container: HTMLElement) =>
    container.querySelector('[data-testid="manual-duplicate-warning"]');

  /** 事前警告の照合に使う既存レコード（大阪支社・電気・2024年11月）。 */
  const existingElectricityNov = (
    overrides: Partial<SavedManualActivityRecord> = {},
  ): SavedManualActivityRecord => ({
    id: 'rec-existing',
    locationId: OSAKA.id,
    locationName: OSAKA.name,
    energyType: 'electricity',
    amount: 1000,
    unit: 'kWh',
    periodStart: '2024-11-01',
    periodEnd: '2024-11-30',
    note: null,
    createdAt: '2024-12-01T00:00:00Z',
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

  it('新規: 拠点・カテゴリ・対象年月が既存レコードと揃った時点で警告し、月を変えると消える', async () => {
    const onOpenDuplicateRecord = vi.fn();
    const existing = existingElectricityNov();
    const { container } = renderForm({
      historyRecords: [existing],
      onOpenDuplicateRecord,
    });
    await flush();

    // 既定の対象月（2025-01）は重複していないため警告なし。
    expect(duplicateWarning(container)).toBeNull();

    setSelectValue(monthInput(container), '2024-11');
    const warning = duplicateWarning(container);
    expect(warning?.textContent).toContain('『大阪支社』の電気・2024年11月 の活動量は既に登録済みです');
    expect(warning?.textContent).toContain('活動量を合算してください');
    // 警告は事前の注意にとどめ、プレビュー・保存は止めない（確定判定は保存時チェック）。
    expect(previewButton(container).disabled).toBe(false);

    click(findButton(container, '既存のレコードを開く'));
    expect(onOpenDuplicateRecord).toHaveBeenCalledWith(existing);

    setSelectValue(monthInput(container), '2024-12');
    expect(duplicateWarning(container)).toBeNull();
  });

  it('新規: カテゴリが違えば同じ拠点・対象月でも警告しない', async () => {
    const { container } = renderForm({ historyRecords: [existingElectricityNov()] });
    await flush();

    setSelectValue(categorySelect(container), 'energy:city_gas');
    setSelectValue(monthInput(container), '2024-11');

    expect(duplicateWarning(container)).toBeNull();
  });

  it('編集: 自分自身は重複に数えず、対象月を他レコードと同じへ変えたときだけ警告する', async () => {
    const self = existingElectricityNov({ id: 'rec-self' });
    const other = existingElectricityNov({
      id: 'rec-other',
      periodStart: '2024-12-01',
      periodEnd: '2024-12-31',
    });
    const { container } = renderForm({
      mode: 'edit',
      initialValues: editScope12(),
      historyRecords: [self, other],
      excludeRecordId: 'rec-self',
    });
    await flush();

    // 開いた直後（条件未変更）は自分自身と一致するが警告しない。
    expect(duplicateWarning(container)).toBeNull();

    setSelectValue(monthInput(container), '2024-12');
    const warning = duplicateWarning(container);
    expect(warning?.textContent).toContain('2024年12月 の活動量は既に登録済みです');
    // 編集モーダルからは onOpenDuplicateRecord を渡さないため、乗り換え導線は出ない。
    expect(warning?.textContent).not.toContain('既存のレコードを開く');
  });

  it('新規: 翌月へ送れない保存の直後は同じ条件のまま履歴に加わっても警告せず、条件を変えると通常どおり警告する', async () => {
    const existingDec = existingElectricityNov({
      id: 'rec-dec',
      periodStart: '2024-12-01',
      periodEnd: '2024-12-31',
    });
    const { container, onSave, rerender } = renderForm({
      historyRecords: [existingDec],
      onOpenDuplicateRecord: vi.fn(),
    });
    await flush();
    // 当月（2025-01）で保存する。未来月へは送らないので、拠点・カテゴリ・対象年月がそのまま残る。
    expect(monthInput(container).value).toBe('2025-01');
    setInputValue(amountInput(container), '10000');
    expect(duplicateWarning(container)).toBeNull();

    openPreview(container);
    await saveFromPreview(container);
    expect(onSave).toHaveBeenCalledTimes(1);

    // 親（DataInput）は保存したレコードを履歴の先頭に加える。拠点・カテゴリ・対象年月は保持されたままだが、
    // 今保存した分を「既に登録済み」とは知らせない（保存成功の通知と並んで警告が出ないようにする）。
    rerender({
      historyRecords: [
        existingElectricityNov({ id: 'rec-saved', periodStart: '2025-01-01', periodEnd: '2025-01-31' }),
        existingDec,
      ],
    });
    expect(amountInput(container).value).toBe('');
    expect(monthInput(container).value).toBe('2025-01');
    expect(duplicateWarning(container)).toBeNull();

    // 条件を変えれば通常どおり警告する。
    setSelectValue(monthInput(container), '2024-12');
    expect(duplicateWarning(container)?.textContent).toContain('2024年12月 の活動量は既に登録済みです');

    // 一度条件を変えたあとに保存時の条件へ戻した場合も警告する（抑止は保存直後だけ）。
    setSelectValue(monthInput(container), '2025-01');
    expect(duplicateWarning(container)?.textContent).toContain('2025年1月 の活動量は既に登録済みです');
  });

  it('新規: 保存後に翌月へ送った先が登録済みなら、その月の警告を出す', async () => {
    const existingDec = existingElectricityNov({
      id: 'rec-dec',
      periodStart: '2024-12-01',
      periodEnd: '2024-12-31',
    });
    const { container, onSave, rerender } = renderForm({
      historyRecords: [existingDec],
      onOpenDuplicateRecord: vi.fn(),
    });
    await flush();
    setSelectValue(monthInput(container), '2024-11');
    setInputValue(amountInput(container), '10000');
    expect(duplicateWarning(container)).toBeNull();

    openPreview(container);
    await saveFromPreview(container);
    expect(onSave).toHaveBeenCalledTimes(1);

    // 対象年月は 2024-12 へ送られる。保存した 2024-11 の分は警告せず、送り先の登録済みレコードを知らせる。
    rerender({ historyRecords: [existingElectricityNov({ id: 'rec-saved' }), existingDec] });
    expect(monthInput(container).value).toBe('2024-12');
    expect(duplicateWarning(container)?.textContent).toContain('2024年12月 の活動量は既に登録済みです');
  });

  // ---- 複数月まとめて入力（一括入力） ----

  const savedRecord = (
    overrides: Partial<SavedManualActivityRecord> &
      Pick<SavedManualActivityRecord, 'id' | 'periodStart'>,
  ): SavedManualActivityRecord => ({
    locationId: OSAKA.id,
    locationName: OSAKA.name,
    energyType: 'electricity',
    amount: 500,
    unit: 'kWh',
    periodEnd: overrides.periodStart.replace(/-01$/, '-28'),
    note: null,
    createdAt: '2024-12-01T00:00:00Z',
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

  const renderBulkForm = (props: Partial<ActivityEntryFormProps> = {}) => {
    const onSaveBulk = vi.fn<NonNullable<ActivityEntryFormProps['onSaveBulk']>>().mockResolvedValue(undefined);
    const rendered = renderForm({ onSaveBulk, historyRecords: [], ...props });
    return { ...rendered, onSaveBulk };
  };

  const bulkAmountInput = (container: HTMLElement, month: string) =>
    q<HTMLInputElement>(container, `#manual-bulk-amount-${month}`);

  it('一括入力: onSaveBulk が無ければ切替を出さず、切り替えると年度の月グリッドになる', async () => {
    const plain = renderForm();
    await flush();
    expect(plain.container.querySelector('#manual-entry-mode-bulk')).toBeNull();
    plain.rerender();
    mounted?.unmount();
    document.body.innerHTML = '';

    const { container } = renderBulkForm();
    await flush();
    expect(q(container, '#manual-entry-mode-bulk')).not.toBeNull();

    await clickAsync(q(container, '#manual-entry-mode-bulk'));

    // 対象年月の代わりに対象年度を選び、年度の 12 ヶ月がグリッドに並ぶ。
    expect(container.querySelector('#manual-target-month')).toBeNull();
    expect(q<HTMLSelectElement>(container, '#manual-bulk-fiscal-year').value).toBe('fy2024');
    const grid = q(container, '[data-testid="manual-bulk-grid"]');
    expect(grid.querySelectorAll('input[type="text"]')).toHaveLength(12);
    // 当月（2025-01）より後の月は入力できない。
    expect(bulkAmountInput(container, '2024-12').disabled).toBe(false);
    expect(bulkAmountInput(container, '2025-02').disabled).toBe(true);
    expect(grid.textContent).toContain('未来月のため入力できません');
  });

  it('一括入力: 入力した月だけを確認モーダルに並べ、月ごとの係数IDで onSaveBulk に渡す', async () => {
    const { container, onSaveBulk } = renderBulkForm();
    await flush();
    await clickAsync(q(container, '#manual-entry-mode-bulk'));

    setInputValue(bulkAmountInput(container, '2024-11'), '10000');
    setInputValue(bulkAmountInput(container, '2024-12'), '20000');

    await clickAsync(previewButton(container));
    const preview = q(container, '.modal-content');
    expect(preview.querySelector('h2')?.textContent).toBe('一括入力内容の確認');
    const table = q(preview, '[data-testid="manual-bulk-preview-table"]');
    expect(table.textContent).toContain('2024年11月');
    expect(table.textContent).toContain('2024年12月');
    // 代替値 0.00055 t-CO2/kWh × (10,000 + 20,000) kWh = 16.5 t-CO2e
    expect(q(preview, '[data-testid="manual-bulk-preview-total"]').textContent).toBe('16.5 t-CO2e');

    await clickAsync(q(container, '#manual-bulk-save-button'));

    expect(onSaveBulk).toHaveBeenCalledTimes(1);
    const items = onSaveBulk.mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      action: 'create',
      month: '2024-11',
      entry: {
        kind: 'scope12',
        input: {
          locationId: 'loc-1',
          energyType: 'electricity',
          amount: 10000,
          unit: 'kWh',
          periodStart: '2024-11-01',
          periodEnd: '2024-11-30',
          emissionFactorId: 'national',
        },
      },
    });
    expect(items[1]).toMatchObject({ action: 'create', month: '2024-12' });
    // 保存成功後はグリッドの入力値を破棄する。
    expect(modal(container)).toBeNull();
    expect(bulkAmountInput(container, '2024-11').value).toBe('');
  });

  it('一括入力: 登録済みの月は値を表示してスキップし、上書きを選んだ月だけ更新として渡す', async () => {
    const existing = savedRecord({ id: 'rec-oct', periodStart: '2024-10-01', amount: 500, note: '既存メモ' });
    const { container, onSaveBulk } = renderBulkForm({ historyRecords: [existing] });
    await flush();
    await clickAsync(q(container, '#manual-entry-mode-bulk'));

    // 登録済みの月は値を表示し、入力は上書きを選ぶまで無効。
    const grid = q(container, '[data-testid="manual-bulk-grid"]');
    expect(grid.textContent).toContain('登録済み: 500 kWh');
    expect(bulkAmountInput(container, '2024-10').disabled).toBe(true);

    await clickAsync(q(container, '#manual-bulk-overwrite-2024-10'));
    const input = bulkAmountInput(container, '2024-10');
    expect(input.disabled).toBe(false);
    // 既存の活動量を初期表示する。
    expect(input.value).toBe('500');
    setInputValue(input, '600');

    await clickAsync(previewButton(container));
    expect(q(container, '[data-testid="manual-bulk-preview-table"]').textContent).toContain('上書き');
    await clickAsync(q(container, '#manual-bulk-save-button'));

    const items = onSaveBulk.mock.calls[0][0];
    expect(items).toHaveLength(1);
    // 上書きは既存レコードの更新として渡し、備考は既存の値を保持する。
    expect(items[0]).toMatchObject({
      action: 'overwrite',
      recordId: 'rec-oct',
      entry: { kind: 'scope12', input: { amount: 600, note: '既存メモ' } },
    });
  });

  it('一括入力: 入力が無ければ確認モーダルを開かずエラーを出す', async () => {
    const { container, onSaveBulk } = renderBulkForm();
    await flush();
    await clickAsync(q(container, '#manual-entry-mode-bulk'));

    await clickAsync(previewButton(container));

    expect(modal(container)).toBeNull();
    expect(alertText(container)).toContain('登録する月の活動量を入力してください');
    expect(onSaveBulk).not.toHaveBeenCalled();
  });

  it('一括入力: 全月が未来の年度は対象年度の選択肢に出さず、当月が属する年度を既定にする', async () => {
    Object.assign(fiscalYearMock, { fiscalYears: [FY2025, FY2024, FY2023] });
    const { container } = renderBulkForm();
    await flush();
    await clickAsync(q(container, '#manual-entry-mode-bulk'));

    const yearSelect = q<HTMLSelectElement>(container, '#manual-bulk-fiscal-year');
    expect([...yearSelect.options].map((option) => option.value)).toEqual(['fy2024', 'fy2023']);
    expect(yearSelect.value).toBe('fy2024');
  });

  it('一括入力: 登録済みの月はグリッドの行で示し、代表月に対する重複の事前警告は出さない', async () => {
    // 代表月（年度内で最初に入力できる月 = 2024-04）に既存レコードがある。
    const existing = savedRecord({ id: 'rec-apr', periodStart: '2024-04-01' });
    const { container } = renderBulkForm({ historyRecords: [existing] });
    await flush();
    await clickAsync(q(container, '#manual-entry-mode-bulk'));

    expect(q(container, '[data-testid="manual-bulk-grid"]').textContent).toContain('登録済み: 500 kWh');
    expect(container.querySelector('[data-testid="manual-duplicate-warning"]')).toBeNull();
  });

  it('一括入力: 全角数字・カンマは半角へ正規化して受け付け、数字にならない入力は理由を出して戻す', async () => {
    const { container } = renderBulkForm();
    await flush();
    await clickAsync(q(container, '#manual-entry-mode-bulk'));

    const input = bulkAmountInput(container, '2024-11');
    setInputValue(input, '１２，３４５．５');
    expect(input.value).toBe('12345.5');
    expect(container.querySelector('[data-testid="manual-bulk-amount-rejected-2024-11"]')).toBeNull();

    setInputValue(input, '12345.5a');
    expect(input.value).toBe('12345.5');
    expect(q(container, '[data-testid="manual-bulk-amount-rejected-2024-11"]').textContent).toBe(
      '活動量は数字と小数点のみ入力できます。',
    );

    // IME 変換中は巻き戻さず、確定時に正規化する。
    fireComposition(input, 'compositionstart');
    setInputValue(input, '６７８');
    expect(input.value).toBe('６７８');
    fireComposition(input, 'compositionend');
    expect(input.value).toBe('678');
    expect(container.querySelector('[data-testid="manual-bulk-amount-rejected-2024-11"]')).toBeNull();
  });

  it('一括入力: 活動量 0 の月は実績ゼロとして確認表示を添えて保存する', async () => {
    const { container, onSaveBulk } = renderBulkForm();
    await flush();
    await clickAsync(q(container, '#manual-entry-mode-bulk'));

    setInputValue(bulkAmountInput(container, '2024-11'), '0');
    await clickAsync(previewButton(container));

    const table = q(container, '[data-testid="manual-bulk-preview-table"]');
    expect(table.textContent).toContain('0 kWh');
    expect(table.textContent).toContain('活動量 0 で保存します');
    await clickAsync(q(container, '#manual-bulk-save-button'));

    expect(onSaveBulk.mock.calls[0][0][0]).toMatchObject({
      action: 'create',
      month: '2024-11',
      entry: { kind: 'scope12', input: { amount: 0 } },
    });
  });

  it('請求書から反映（電気）: 拠点・対象年月・活動量・備考と、事業者別係数の事業者を選んだ状態で始まる', async () => {
    vi.mocked(getProviderFactors).mockResolvedValue([tepcoAdjusted, tepcoBasic]);
    const { container, onSave } = renderForm({
      prefill: {
        locationId: OSAKA.id,
        supplyAddress: null,
        energyType: 'electricity',
        targetMonth: '2024-11',
        amount: '10000',
        note: '請求書から読取り 東京電力エナジーパートナー株式会社 2024年11月分',
        // 事業者名は前後の空白を落としてから選択肢と突き合わせる（normalizeProviderName）
        factor: { kind: 'provider', providerName: ` ${TEPCO} `, menuName: null },
        sourceLabel: '請求書「11月分.pdf」から読み取った値を入れました。',
      },
    });
    await flush();

    expect(container.textContent).toContain('請求書「11月分.pdf」から読み取った値を入れました。');
    expect(monthInput(container).value).toBe('2024-11');
    expect(amountInput(container).value).toBe('10000');
    expect(noteInput(container).value).toBe('請求書から読取り 東京電力エナジーパートナー株式会社 2024年11月分');
    expect(q<HTMLInputElement>(container, '#manual-provider-select').value).toContain(TEPCO);
    expect(factorDetailText(container)).toContain('0.0004 t-CO2/kWh');
    expect(resultEmissionsText(container)).toBe('4 t-CO2e');

    openPreview(container);
    await saveFromPreview(container);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      kind: 'scope12',
      input: { energyType: 'electricity', amount: 10000, periodStart: '2024-11-01', emissionFactorId: 'tepco-adjusted' },
    });
  });

  it('請求書から反映（燃料）: 同じ名前の標準係数の候補を選び、候補セレクトで選び直せる', async () => {
    const heavyA = factor({ id: 'heavy-a', name: '燃料 A重油', factorValue: 2.75, energyType: 'fuel_heavy_oil', scope: 'scope1', unit: 'tCO2/kL', factorType: null });
    const heavyBC = factor({ id: 'heavy-bc', name: '燃料 B・C重油', factorValue: 3.1, energyType: 'fuel_heavy_oil', scope: 'scope1', unit: 'tCO2/kL', factorType: null });
    vi.mocked(getActiveScope12Factors).mockResolvedValue([national, heavyA, heavyBC]);
    const { container } = renderForm({
      prefill: {
        locationId: OSAKA.id,
        supplyAddress: null,
        energyType: 'fuel_heavy_oil',
        targetMonth: '2024-11',
        amount: '1000',
        note: '',
        factor: { kind: 'standard', factorName: '燃料 B・C重油' },
        sourceLabel: '',
      },
    });
    await flush();

    expect(categorySelect(container).value).toBe('energy:fuel_heavy_oil');
    const factorSelect = q<HTMLSelectElement>(container, '#manual-factor-select');
    expect(factorSelect.value).toBe('heavy-bc');
    expect(resultEmissionsText(container)).toBe('3.1 t-CO2e');

    setSelectValue(factorSelect, 'heavy-a');
    expect(factorSelect.value).toBe('heavy-a');
    expect(resultEmissionsText(container)).toBe('2.75 t-CO2e');
  });

  it('編集では prefill を使わない（初期値は登録済みの記録）', async () => {
    const { container } = renderForm({
      mode: 'edit',
      initialValues: editScope12({ amount: '500' }),
      prefill: {
        locationId: OSAKA.id,
        supplyAddress: null,
        energyType: 'electricity',
        targetMonth: '2024-12',
        amount: '99999',
        note: '',
        factor: null,
        sourceLabel: '請求書から読み取った値です。',
      },
    });
    await flush();
    expect(amountInput(container).value).toBe('500');
    expect(container.textContent).not.toContain('請求書から読み取った値です。');
  });

  describe('帳票（請求書など）', () => {
    const evidenceFile = (overrides: Partial<EvidenceFile> = {}): EvidenceFile => ({
      id: 'file-1',
      fileName: '11月分.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      convertedFrom: null,
      storagePath: 'org/activity-evidence/file-1.pdf',
      createdAt: '2024-12-01T00:00:00Z',
      uploadedBy: 'user-1',
      ...overrides,
    });
    const evidenceInput = (container: HTMLElement) => q<HTMLInputElement>(container, 'input[aria-label="帳票のファイル"]');
    const chooseEvidence = async (container: HTMLElement, file: File) => {
      const input = evidenceInput(container);
      await act(async () => {
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };

    it('新規: 上げた帳票をプレビューに出し、保存で ID を渡して欄を空にする', async () => {
      vi.mocked(uploadEvidenceFile).mockResolvedValue(evidenceFile());
      const { container, onSave } = renderForm();
      await flush();

      await chooseEvidence(container, new File([new Uint8Array(10)], '11月分.pdf', { type: 'application/pdf' }));
      expect(uploadEvidenceFile).toHaveBeenCalledWith(expect.any(File), null);
      expect(q(container, '[data-testid="evidence-field"]').textContent).toContain('11月分.pdf');

      setSelectValue(monthInput(container), '2024-11');
      setInputValue(amountInput(container), '10000');
      openPreview(container);
      expect(previewRowText(container, '帳票')).toBe('帳票11月分.pdf');
      await saveFromPreview(container);

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scope12' }), { evidenceFileIds: ['file-1'] });
      expect(q(container, '[data-testid="evidence-field"]').textContent).toContain('帳票はまだありません。');
    });

    it('新規: 帳票を保存している間はプレビューを押せない', async () => {
      const pending = deferred<EvidenceFile>();
      vi.mocked(uploadEvidenceFile).mockReturnValue(pending.promise);
      const { container } = renderForm();
      await flush();
      setInputValue(amountInput(container), '10');

      await chooseEvidence(container, new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }));
      expect(previewButton(container).disabled).toBe(true);
      await act(async () => pending.resolve(evidenceFile()));
      expect(previewButton(container).disabled).toBe(false);
    });

    it('送れない形式は上げずに理由を出す', async () => {
      const { container } = renderForm();
      await flush();
      await chooseEvidence(container, new File(['x'], 'memo.txt', { type: 'text/plain' }));
      expect(uploadEvidenceFile).not.toHaveBeenCalled();
      expect(q(container, '[data-testid="evidence-field"]').textContent).toContain('memo.txt: PDF・PNG・JPEG・WebP のファイルを選んでください');
    });

    it('編集: 紐づいている帳票を読み、外すとその場で記録から外す', async () => {
      vi.mocked(getRecordEvidence).mockResolvedValue([evidenceFile()]);
      const onEvidenceChange = vi.fn();
      const { container } = renderForm({ mode: 'edit', initialValues: editScope12(), recordId: 'rec-1', onEvidenceChange });
      await flush();

      expect(getRecordEvidence).toHaveBeenCalledWith('rec-1');
      expect(q(container, '[data-testid="evidence-field"]').textContent).toContain('11月分.pdf');
      await clickAsync(q(container, 'button[aria-label="11月分.pdf を外す"]'));

      expect(unlinkEvidence).toHaveBeenCalledWith('rec-1', 'file-1');
      expect(onEvidenceChange).toHaveBeenCalledTimes(1);
      expect(q(container, '[data-testid="evidence-field"]').textContent).toContain('帳票はまだありません。');
    });

    it('一括入力では帳票の欄を出さない', async () => {
      const { container } = renderBulkForm();
      await flush();
      await clickAsync(q(container, '#manual-entry-mode-bulk'));
      expect(container.querySelector('[data-testid="evidence-field"]')).toBeNull();
    });
  });

  describe('請求書から反映（拠点が決まらなかった）', () => {
    const NAGOYA: ManualEntryLocationOption = { id: 'loc-2', name: '名古屋工場', region: 'Chubu' };
    const unresolvedPrefill = (supplyAddress: string | null) => ({
      locationId: '',
      supplyAddress,
      energyType: 'electricity' as const,
      targetMonth: '2024-11',
      amount: '10000',
      note: '',
      factor: null,
      sourceLabel: '',
    });
    const locationSelect = (container: HTMLElement) => q<HTMLSelectElement>(container, '#manual-location-select');

    it('先頭の拠点に倒さず未選択にし、住所を添えて案内し、拠点を選ぶまでプレビューを押せない', async () => {
      const { container } = renderForm({
        locations: [OSAKA, NAGOYA],
        prefill: unresolvedPrefill('東京都架空区架空町9-9-9'),
      });
      await flush();

      expect(locationSelect(container).value).toBe('');
      expect(locationSelect(container).options[0].textContent).toBe('拠点を選んでください');
      expect(q(container, '#manual-location-select-error').textContent).toBe(
        '請求書の住所（東京都架空区架空町9-9-9）から拠点を決められませんでした。拠点を選んでください',
      );
      expect(locationSelect(container).getAttribute('aria-describedby')).toBe('manual-location-select-error');
      expect(previewButton(container).disabled).toBe(true);
      // 拠点が無い間は係数を判定しない（取得中・候補なしの表示を出さない）
      expect(q(container, '[data-testid="manual-factor-section"]').textContent).toContain('拠点を選ぶと適用係数を表示します。');
      expect(countText(container, LOADING_TEXT)).toBe(0);

      setSelectValue(locationSelect(container), NAGOYA.id);
      await flush();

      expect(locationSelect(container).value).toBe(NAGOYA.id);
      expect(container.querySelector('#manual-location-select-error')).toBeNull();
      expect([...locationSelect(container).options].map((option) => option.textContent)).toEqual(['大阪支社', '名古屋工場']);
      expect(previewButton(container).disabled).toBe(false);
      expect(resultEmissionsText(container)).toBe('5.5 t-CO2e');
    });

    it('住所が読めなかったときは、読めなかったことを案内する', async () => {
      const { container } = renderForm({ locations: [OSAKA, NAGOYA], prefill: unresolvedPrefill(null) });
      await flush();
      expect(q(container, '#manual-location-select-error').textContent).toBe(
        '請求書から需要場所の住所を読み取れなかったため、拠点を決められませんでした。拠点を選んでください',
      );
    });

    it('拠点が決まっていれば、その拠点を選んだ状態で始まり案内は出さない', async () => {
      const { container } = renderForm({
        locations: [OSAKA, NAGOYA],
        prefill: { ...unresolvedPrefill('愛知県架空市架空町2-1-1'), locationId: NAGOYA.id },
      });
      await flush();
      expect(locationSelect(container).value).toBe(NAGOYA.id);
      expect(container.querySelector('#manual-location-select-error')).toBeNull();
      expect(previewButton(container).disabled).toBe(false);
    });
  });
});
