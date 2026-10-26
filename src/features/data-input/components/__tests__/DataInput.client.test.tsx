// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { getActivityHistoryRecords, getManualEntryLocations } from '../../services/activityRecordService';
import type { SavedManualActivityRecord } from '../../types';
import { DataInput } from '../DataInput.client';

// データ入力画面の回帰テスト（入力履歴まわり）。
// 「取得した履歴が並ぶ」「キーワードで絞り込めて、クリアで戻る」「行クリックで編集モーダルが開く」を固定する。
// 入力フォーム（ActivityEntryForm）は自分のテストを持つので、ここでは呼び出し方だけが分かるスタブに差し替える。

vi.mock('../../services/activityRecordService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/activityRecordService')>()),
  getManualEntryLocations: vi.fn(),
  getActivityHistoryRecords: vi.fn(),
}));

vi.mock('../../services/provisionalRecalculation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/provisionalRecalculation')>()),
  fetchProvisionalRecalculationTargets: vi.fn(async () => []),
}));

vi.mock('../ActivityEntryForm.client', () => ({
  ActivityEntryForm: ({ mode = 'create', prefill }: { mode?: 'create' | 'edit'; prefill?: { sourceLabel: string } }) => (
    <div data-testid="entry-form" data-mode={mode} data-prefill={prefill?.sourceLabel ?? ''} />
  ),
}));

// 請求書の読取り（AI）は自分のテストを持つので、「フォームで開く」を押したことにするボタンだけのスタブにする。
vi.mock('@/features/invoice-reading/components/InvoiceReadingCard.client', () => ({
  InvoiceReadingCard: ({ onApply }: { onApply: (prefill: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onApply({
          locationId: 'loc-1',
          supplyAddress: '東京都架空区架空町1-1-1',
          energyType: 'electricity',
          targetMonth: '2025-09',
          amount: '12345',
          note: '請求書から読取り',
          factor: null,
          sourceLabel: '請求書「9月分.pdf」から読み取った値を入れました。',
        })
      }
    >
      反映する（スタブ）
    </button>
  ),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ profile: { id: 'user-1', organizationId: 'org-1' }, role: 'member', isLoading: false }),
}));

vi.mock('@/hooks/useFiscalYear', () => ({
  useFiscalYear: () => ({ fiscalYearId: 'fy2025', fiscalYear: '2025', fiscalYears: [], isLoading: false }),
}));

vi.mock('@/hooks/useAppRefresh', () => ({
  useAppRefresh: () => ({ refreshToken: 0, refresh: () => {} }),
}));

const record = (overrides: Partial<SavedManualActivityRecord> & { id: string }): SavedManualActivityRecord => ({
  locationId: 'loc-1',
  locationName: '東京本社',
  energyType: 'electricity',
  amount: 1200,
  unit: 'kWh',
  periodStart: '2025-04-01',
  periodEnd: '2025-04-30',
  note: null,
  createdAt: '2025-05-01T09:00:00+09:00',
  emissionFactorId: null,
  emissions: 0.5,
  appliedFactorName: null,
  appliedFactorValue: null,
  appliedFactorUnit: null,
  scope3CategoryId: null,
  ideaFactorId: null,
  ideaProductName: null,
  evidenceCount: 0,
  ...overrides,
});

const HISTORY: SavedManualActivityRecord[] = [
  record({ id: 'r1', evidenceCount: 2 }),
  record({ id: 'r2', locationId: 'loc-2', locationName: '大阪支社', energyType: 'city_gas', amount: 30, unit: 'm³', emissions: null }),
];

let view: RenderResult;

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

// データ行だけを数える（「入力履歴はまだありません」などの空状態はセル 1 つの行）。
const rowNames = (): string[] =>
  Array.from(view.container.querySelectorAll('table.gt-table tbody tr'))
    .filter((row) => row.querySelectorAll('td').length > 1)
    .map((row) => row.querySelector('td')?.textContent?.trim() ?? '');

describe('DataInput 入力履歴', () => {
  beforeEach(() => {
    vi.mocked(getManualEntryLocations).mockResolvedValue([
      { id: 'loc-1', name: '東京本社', region: 'Kanto' },
      { id: 'loc-2', name: '大阪支社', region: 'Kansai' },
    ]);
    vi.mocked(getActivityHistoryRecords).mockResolvedValue(HISTORY);
  });

  afterEach(() => {
    view?.unmount();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('取得した履歴が並び、未算定の行は「未算定」と表示される', async () => {
    view = render(<DataInput />);
    await flush();

    expect(rowNames()).toEqual(['東京本社', '大阪支社']);
    expect(view.container.textContent).toContain('登録済み 2 件');
    expect(view.container.textContent).toContain('未算定');
    expect(view.container.querySelector('[data-testid="entry-form"]')?.getAttribute('data-mode')).toBe('create');
    // 帳票が紐づいている記録には件数を出す（紐づいていない記録には出さない）
    expect(view.container.querySelectorAll('[aria-label="帳票 2 件"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[aria-label="帳票なし"]')).toHaveLength(1);
  });

  it('キーワードで絞り込め、「絞り込みをクリア」で全件に戻る', async () => {
    view = render(<DataInput />);
    await flush();

    const search = view.container.querySelector<HTMLInputElement>('#history-search')!;
    setInputValue(search, '大阪');
    expect(rowNames()).toEqual(['大阪支社']);

    setInputValue(search, '存在しない拠点');
    expect(rowNames()).toEqual([]);
    expect(view.container.textContent).toContain('条件に一致する入力履歴が見つかりません');

    const clearButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '絞り込みをクリア',
    )!;
    click(clearButton);
    expect(rowNames()).toEqual(['東京本社', '大阪支社']);
  });

  it('行をクリックすると編集モードのフォームが開き、オーバーレイのクリックで閉じる', async () => {
    view = render(<DataInput />);
    await flush();

    const firstRow = view.container.querySelector<HTMLTableRowElement>('table.gt-table tbody tr')!;
    click(firstRow);
    const editForm = document.querySelector('[data-testid="entry-form"][data-mode="edit"]');
    expect(editForm).not.toBeNull();

    click(document.querySelector('.modal-overlay')!);
    expect(document.querySelector('[data-testid="entry-form"][data-mode="edit"]')).toBeNull();
  });

  it('請求書の読取りの「フォームで開く」で、新規入力のフォームに読み取った値を渡す', async () => {
    // jsdom は scrollIntoView を持たないため、呼ばれたことだけを見る。
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    view = render(<DataInput />);
    await flush();

    const createForm = () => view.container.querySelector('[data-testid="entry-form"][data-mode="create"]');
    expect(createForm()?.getAttribute('data-prefill')).toBe('');
    const applyButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '反映する（スタブ）',
    )!;
    click(applyButton);
    expect(createForm()?.getAttribute('data-prefill')).toBe('請求書「9月分.pdf」から読み取った値を入れました。');
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
