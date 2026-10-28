// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { uploadEvidenceFile } from '@/features/activity-evidence/services/evidenceClient';
import type { EvidenceFile } from '@/features/activity-evidence/types';
import type { CandidateFactorRow } from '@/features/data-input/services/factorSelectionService';
import type { ManualEntryLocationOption, SavedManualActivityRecord } from '@/features/data-input/types';
import type { AiStatus } from '@/types/ai';
import { requestInvoiceReading } from '../../services/invoiceReadingClient';
import type { InvoiceReadingItem, InvoiceReadingResult } from '../../types';
import { InvoiceReadingCard } from '../InvoiceReadingCard.client';

// 「請求書から読み取る」カード: AI が使えないときは選べない、送る前に確認を出す（請求書は帳票として残すと伝える）、
// 読み取った明細を表に並べ、確かめることが無い行だけを既定で選び、確認してからまとめて登録する。

const statusMock = vi.hoisted(() => ({
  value: { status: null as AiStatus | null, error: null as string | null, isLoading: false },
}));
vi.mock('@/features/ai/hooks/useAiStatus', () => ({
  useAiStatus: () => ({ ...statusMock.value, refresh: async () => {} }),
}));
vi.mock('@/hooks/useFiscalYear', () => ({
  useFiscalYear: () => ({ fiscalYears: [{ id: 'fy2025', startDate: '2025-04-01', endDate: '2026-03-31' }] }),
}));
vi.mock('@/features/activity-evidence/services/evidenceClient', () => ({
  uploadEvidenceFile: vi.fn(),
  openEvidenceFile: vi.fn(async () => {}),
}));
vi.mock('../../services/invoiceReadingClient', () => ({ requestInvoiceReading: vi.fn() }));

const factorPool = vi.hoisted(() => ({ year: [] as unknown[], provider: [] as unknown[] }));
vi.mock('@/features/data-input/services/factorSelectionService', () => ({
  getActiveScope12Factors: async () => factorPool.year,
  getProviderFactors: async () => factorPool.provider,
}));

const STATUS: AiStatus = {
  keySource: 'server',
  configured: true,
  provider: 'google',
  modelId: 'gemini-3.5-flash',
  canManage: false,
  allowedProviders: [],
  registeredKey: null,
  needsReRegistration: false,
  leftoverKey: false,
};

const TOKYO: ManualEntryLocationOption = { id: 'tokyo', name: '東京本社', region: 'Kanto' };
const OSAKA: ManualEntryLocationOption = { id: 'osaka', name: '大阪支社', region: 'Kansai' };
const TEPCO = '東京電力エナジーパートナー(株)';

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

const provider = { providerName: TEPCO, providerNumber: 'A0269', source: 'utility' as const };
const YEAR_FACTORS = [
  factor({ id: 'national', name: '電気 代替値（全国）', factorValue: 0.00044 }),
  factor({ id: 'gasoline', name: '燃料 揮発油', energyType: 'fuel_gasoline', scope: 'scope1', unit: 't-CO2/kL', factorValue: 2.29 }),
];
const PROVIDER_FACTORS = [
  factor({ id: 'tepco-a', name: `${TEPCO} メニューA`, menuName: 'メニューA', factorValue: 0.0003, ...provider }),
  factor({ id: 'tepco-l', name: `${TEPCO} メニューL(残差)`, menuName: 'メニューL(残差)', ...provider }),
];

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
    note: '請求書から読取り 電気',
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
  amount: { value: 100, unit: 'L' },
  printedAmount: '100 L',
  planOrFuelName: 'レギュラー',
  factor: { status: 'matched', label: '燃料 揮発油', reason: 'ガソリンは揮発油' },
  location: { id: 'osaka', name: '大阪支社' },
  prefill: {
    ...electricityItem.prefill!,
    locationId: 'osaka',
    energyType: 'fuel_gasoline',
    amount: '100',
    note: '請求書から読取り ガソリン',
    factor: { kind: 'standard', factorName: '燃料 揮発油' },
  },
};

const otherItem: InvoiceReadingItem = {
  ...electricityItem,
  index: 3,
  energyType: null,
  title: '水道 2025年9月分',
  factor: { status: 'unavailable', reason: '対象外の請求書です' },
  notices: [],
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

const tokyoSeptember: SavedManualActivityRecord = {
  id: 'rec-1',
  locationId: 'tokyo',
  locationName: '東京本社',
  energyType: 'electricity',
  amount: 900,
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
};

let view: RenderResult | null = null;

const renderCard = (props: Partial<React.ComponentProps<typeof InvoiceReadingCard>> = {}) => {
  const onApply = vi.fn();
  const onSaveRows = vi.fn(async () => ({ savedKeys: [] as string[], failures: [] as Array<{ key: string; reason: string }> }));
  view = render(
    <InvoiceReadingCard locations={[TOKYO, OSAKA]} historyRecords={[]} onApply={onApply} onSaveRows={onSaveRows} {...props} />,
  );
  return { onApply, onSaveRows };
};

const buttonByText = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.trim() === text);

const chooseFiles = (files: File[]) => {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
  act(() => {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const pdf = (name: string, size = 2048) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

// 帳票の保存 → 読取り → 行ごとの係数の解決（非同期）を終わらせる。
const settle = async () => {
  for (let index = 0; index < 5; index += 1) await act(async () => {});
};

// 行の「登録する」は shadcn の Checkbox（role="checkbox" のボタン。状態は aria-checked）。
const checkbox = (title: string) =>
  document.body.querySelector<HTMLButtonElement>(`button[role="checkbox"][aria-label="${title} を登録する"]`)!;
const isChecked = (title: string) => checkbox(title).getAttribute('aria-checked') === 'true';

// 「WebP に変換して容量を減らす」は文言（Label）から引く（行の「登録する」の Checkbox と取り違えない）。
const CONVERT_LABEL = '画像（PNG・JPEG）を WebP に変換して容量を減らす';
const CONVERT_PREFERENCE_KEY = 'ogt.activityEvidence.convertToWebp';
const convertControl = () => {
  const label = Array.from(document.body.querySelectorAll('label')).find((element) => element.textContent === CONVERT_LABEL)!;
  return { label, checkbox: document.getElementById(label.htmlFor) as HTMLButtonElement };
};

const readAndReview = async () => {
  chooseFiles([pdf('9月分.pdf')]);
  click(buttonByText('送信する')!);
  await settle();
};

describe('InvoiceReadingCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    statusMock.value = { status: STATUS, error: null, isLoading: false };
    factorPool.year = YEAR_FACTORS;
    factorPool.provider = PROVIDER_FACTORS;
    vi.mocked(uploadEvidenceFile).mockReset().mockResolvedValue(EVIDENCE);
    vi.mocked(requestInvoiceReading).mockReset().mockResolvedValue({ ok: true, result: RESULT });
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    document.body.innerHTML = '';
  });

  it('AI が未設定・モデル未選択のときは理由を出し、ファイルを選べない', () => {
    statusMock.value = { status: { ...STATUS, modelId: null }, error: null, isLoading: false };
    renderCard();
    expect(document.body.textContent).toContain('AI のモデルが選ばれていません');
    expect((buttonByText('ファイルを選ぶ') as HTMLButtonElement).disabled).toBe(true);
    expect(convertControl().checkbox.disabled).toBe(true);
  });

  it('ファイルを選ぶと、送る内容と「請求書は帳票として保存する」ことを確認に出し、「やめる」では保存も送信もしない', () => {
    renderCard();
    chooseFiles([pdf('9月分.pdf'), pdf('大きい.pdf', 4 * 1024 * 1024 + 1)]);
    const text = document.body.textContent;
    expect(text).toContain('「請求書の読取り」のため');
    expect(text).toContain('9月分.pdf（2 KB）');
    expect(text).toContain('大きい.pdf（');
    expect(text).toContain('4MB を超えるため送らず、帳票として保存だけします');
    expect(text).toContain('読み取った事業者名・料金メニュー・燃料の名称と、排出係数の候補（公表値）');
    expect(text).toContain('請求書は帳票としてこのアプリに保存し、登録した記録に紐づけます。');
    expect(text).not.toContain('このアプリにも提供元にも保存しない');

    click(buttonByText('やめる')!);
    expect(uploadEvidenceFile).not.toHaveBeenCalled();
    expect(requestInvoiceReading).not.toHaveBeenCalled();
  });

  it('「WebP に変換して容量を減らす」は Checkbox でも文言でも切り替わり、選択をこのブラウザに覚える', async () => {
    renderCard();
    await settle();
    const { label, checkbox: convert } = convertControl();
    expect(convert.getAttribute('role')).toBe('checkbox');
    expect(convert.getAttribute('aria-checked')).toBe('false');
    click(convert);
    expect(convert.getAttribute('aria-checked')).toBe('true');
    expect(window.localStorage.getItem(CONVERT_PREFERENCE_KEY)).toBe('true');
    click(label);
    expect(convert.getAttribute('aria-checked')).toBe('false');
    expect(window.localStorage.getItem(CONVERT_PREFERENCE_KEY)).toBe('false');
  });

  it('読み取りの途中は「WebP に変換して容量を減らす」を押せない', async () => {
    let finish: (value: Awaited<ReturnType<typeof requestInvoiceReading>>) => void = () => {};
    vi.mocked(requestInvoiceReading).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderCard();
    await readAndReview();
    expect(convertControl().checkbox.disabled).toBe(true);

    await act(async () => finish({ ok: true, result: RESULT }));
    await settle();
    expect(convertControl().checkbox.disabled).toBe(false);
  });

  it('一度に選べる数を超えたら、確認を出さずに理由を出す', () => {
    renderCard();
    chooseFiles(Array.from({ length: 11 }, (_, index) => pdf(`${index}.pdf`)));
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      '一度に選べるのは 10 ファイルまでです（11 ファイルが選ばれました）',
    );
    expect(document.body.textContent).not.toContain('「請求書の読取り」のため');
  });

  it('読み取った明細を表に並べ、確認してから選んだ行をまとめて登録し、登録できた行は表から外す', async () => {
    const { onSaveRows } = renderCard();
    onSaveRows.mockResolvedValue({ savedKeys: ['file-1:1'], failures: [{ key: 'file-1:2', reason: '保存できませんでした' }] });
    await readAndReview();

    expect(document.body.querySelectorAll('[data-testid="invoice-review-row"]')).toHaveLength(2);
    expect(isChecked('電気 2025年9月分')).toBe(true);
    expect(isChecked('ガソリン 2025年9月分')).toBe(true);
    expect(document.body.textContent).toContain('0.4 t-CO2e');
    expect(document.body.textContent).toContain('0.229 t-CO2e');
    // フォームに入れられない明細は、理由と一緒に表の下に出す。
    expect(document.body.textContent).toContain('9月分.pdf「水道 2025年9月分」: 対象外の請求書です');

    // チェックを外すと件数から抜け、付け直すと戻る。
    click(checkbox('ガソリン 2025年9月分'));
    expect(isChecked('ガソリン 2025年9月分')).toBe(false);
    expect(buttonByText('選んだ明細を登録（1 件）')).toBeDefined();
    click(checkbox('ガソリン 2025年9月分'));
    expect(isChecked('ガソリン 2025年9月分')).toBe(true);

    click(buttonByText('選んだ明細を登録（2 件）')!);
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('2 件');
    expect(dialog.textContent).toContain('0.629 t-CO2e');
    expect(dialog.textContent).toContain('9月分.pdf（2 件）');

    click(buttonByText('登録する')!);
    await settle();
    expect(onSaveRows).toHaveBeenCalledWith([
      {
        key: 'file-1:1',
        evidenceFileIds: ['file-1'],
        entry: {
          kind: 'scope12',
          input: expect.objectContaining({
            locationId: 'tokyo',
            energyType: 'electricity',
            amount: 1000,
            unit: 'kWh',
            periodStart: '2025-09-01',
            emissionFactorId: 'tepco-l',
          }),
        },
      },
      {
        key: 'file-1:2',
        evidenceFileIds: ['file-1'],
        entry: {
          kind: 'scope12',
          input: expect.objectContaining({ locationId: 'osaka', energyType: 'fuel_gasoline', unit: 'L', emissionFactorId: 'gasoline' }),
        },
      },
    ]);
    expect(document.body.querySelectorAll('[data-testid="invoice-review-row"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('保存できませんでした');
  });

  it('同じ条件の記録が登録済みの行は選べない。表で拠点を直すと選べるようになる', async () => {
    renderCard({ historyRecords: [tokyoSeptember] });
    await readAndReview();

    expect(checkbox('電気 2025年9月分').disabled).toBe(true);
    expect(document.body.textContent).toContain('同じ拠点・カテゴリ・対象年月の記録が登録済みです');
    expect(buttonByText('選んだ明細を登録（1 件）')).toBeDefined();

    const locationSelect = document.body.querySelectorAll<HTMLSelectElement>('select[aria-label="拠点"]')[0];
    act(() => {
      locationSelect.value = 'osaka';
      locationSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(checkbox('電気 2025年9月分').disabled).toBe(false);
  });

  it('同じ優先度の係数が並ぶ行（重油で A重油か B・C重油か読めなかった）は、候補を選ぶまで選べない', async () => {
    const heavy = { energyType: 'fuel_heavy_oil' as const, scope: 'scope1' as const, unit: 't-CO2/kL' };
    factorPool.year = [
      ...YEAR_FACTORS,
      factor({ id: 'heavy-a', name: '燃料 A重油', factorValue: 2.75, ...heavy }),
      factor({ id: 'heavy-bc', name: '燃料 B・C重油', factorValue: 3.1, ...heavy }),
    ];
    const heavyOilItem: InvoiceReadingItem = {
      ...gasolineItem,
      index: 4,
      energyType: 'fuel_heavy_oil',
      title: '重油 2025年9月分',
      factor: { status: 'not_found', reason: '重油の種類が書かれていません' },
      prefill: { ...gasolineItem.prefill!, energyType: 'fuel_heavy_oil', factor: null },
    };
    vi.mocked(requestInvoiceReading).mockResolvedValue({ ok: true, result: { ...RESULT, items: [heavyOilItem] } });
    renderCard();
    await readAndReview();

    expect(checkbox('重油 2025年9月分').disabled).toBe(true);
    expect(document.body.textContent).toContain('同じ優先度の排出係数が複数あるため、自動では選びません。');
    const factorSelect = document.body.querySelector<HTMLSelectElement>('select[aria-label="排出係数"]')!;
    expect(factorSelect.value).toBe('');
    expect(factorSelect.options[0].textContent).toBe('候補から選んでください');

    act(() => {
      factorSelect.value = 'heavy-a';
      factorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(checkbox('重油 2025年9月分').disabled).toBe(false);
    expect(isChecked('重油 2025年9月分')).toBe(true);
  });

  it('保存した帳票（読み取った請求書）の ID を親へ伝える（「帳票の一覧」で削除させないため）', async () => {
    const onPendingEvidenceChange = vi.fn();
    renderCard({ onPendingEvidenceChange });
    await readAndReview();
    expect(onPendingEvidenceChange).toHaveBeenLastCalledWith(['file-1']);
    view?.unmount();
    view = null;
    expect(onPendingEvidenceChange).toHaveBeenLastCalledWith([]);
  });

  it('「フォームで開く」で、表で直した値をフォームに渡す', async () => {
    const { onApply } = renderCard();
    await readAndReview();

    const firstRow = document.body.querySelector('[data-testid="invoice-review-row"]')!;
    click(Array.from(firstRow.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'フォームで開く')!);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: 'tokyo',
        targetMonth: '2025-09',
        amount: '1000',
        factor: { kind: 'provider', providerName: TEPCO, menuName: 'メニューL(残差)' },
        evidenceFiles: [EVIDENCE],
      }),
    );
  });

  it('読取りに失敗したファイルは、サーバの文を状況に出す', async () => {
    vi.mocked(requestInvoiceReading).mockResolvedValue({
      ok: false,
      status: 502,
      message: '請求書を読み取れませんでした',
      retryAfterSeconds: null,
    });
    renderCard();
    await readAndReview();
    expect(document.body.querySelector('[data-testid="invoice-batch-progress"]')?.textContent).toContain(
      '請求書を読み取れませんでした',
    );
    expect(document.body.querySelector('[data-testid="invoice-review-table"]')).toBeNull();
  });
});
