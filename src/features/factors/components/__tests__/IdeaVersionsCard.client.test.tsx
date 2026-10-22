// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import type { IdeaVersionHistoryController } from '../../hooks/useIdeaVersionHistory';
import type { IdeaImportRecord } from '../../services/ideaImportClient';
import { IdeaVersionsCard } from '../IdeaVersionsCard.client';

// 「IDEAの版と算定年度」カードの表示と入力（状態と操作は useIdeaVersionHistory。ここではスタブを渡す）。

const record = (overrides: Partial<IdeaImportRecord>): IdeaImportRecord => ({
  id: 'imp-1',
  version: 'V1',
  releaseDate: null,
  gwpModel: 'GWP100',
  citationText: '',
  fileName: 'v1.xlsx',
  status: 'completed',
  rowCount: 1200,
  isActive: false,
  unmappedRecordCount: 0,
  skippedRowCount: 0,
  errorMessage: null,
  createdAt: '2025-05-01T00:00:00Z',
  ...overrides,
});

const fiscalYear = (year: number): FiscalYearOption => ({
  id: `fy-${year}`,
  label: `${year}年度`,
  year: String(year),
  startDate: `${year}-04-01`,
  endDate: `${year + 1}-03-31`,
});

const IMPORTS = [
  record({ id: 'imp-3', version: 'V3', isActive: true, createdAt: '2026-05-01T00:00:00Z' }),
  record({ id: 'imp-2', version: 'V2', createdAt: '2025-11-01T00:00:00Z' }),
  record({ id: 'imp-1', version: 'V1' }),
];

const controller = (overrides: Partial<IdeaVersionHistoryController> = {}): IdeaVersionHistoryController => ({
  history: {
    imports: IMPORTS,
    assignments: [{ fiscalYearId: 'fy-2024', importId: 'imp-1' }],
    referenceCountByImportId: { 'imp-3': 0, 'imp-2': 4, 'imp-1': 0 },
  },
  loadError: null,
  reload: async () => {},
  pendingFiscalYearId: null,
  assign: vi.fn(async () => {}),
  importToDelete: null,
  isDeleting: false,
  requestDelete: vi.fn(),
  cancelDelete: vi.fn(),
  confirmDelete: vi.fn(async () => {}),
  ...overrides,
});

/** 制御された <select> の値を変える（React の value 追跡を迂回してネイティブ setter → change）。 */
const setSelectValue = (select: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const rowTexts = (container: HTMLElement, tableIndex: number): string[] =>
  Array.from(container.querySelectorAll('table')[tableIndex].querySelectorAll('tbody tr')).map(
    (row) => row.textContent ?? '',
  );

describe('IdeaVersionsCard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('年度は開始日の順に並び、割り当てた版（無ければ「有効な版を使う」）が選ばれている', () => {
    const { container, unmount } = render(
      <IdeaVersionsCard versions={controller()} fiscalYears={[fiscalYear(2025), fiscalYear(2024)]} />,
    );

    const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));
    expect(rowTexts(container, 0).map((text) => text.slice(0, 6))).toEqual(['2024年度', '2025年度']);
    expect(selects[0].value).toBe('imp-1');
    expect(selects[1].value).toBe('');
    expect(selects[1].options[0].textContent).toBe('有効な版を使う（V3）');
    unmount();
  });

  it('年度の版を選ぶと割り当て、「有効な版を使う」を選ぶと外す', () => {
    const versions = controller();
    const { container, unmount } = render(
      <IdeaVersionsCard versions={versions} fiscalYears={[fiscalYear(2024), fiscalYear(2025)]} />,
    );
    const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));

    setSelectValue(selects[1], 'imp-2');
    expect(versions.assign).toHaveBeenLastCalledWith(fiscalYear(2025), 'imp-2');
    setSelectValue(selects[0], '');
    expect(versions.assign).toHaveBeenLastCalledWith(fiscalYear(2024), null);
    unmount();
  });

  it('取込履歴に割り当て年度・算定での使用件数を出し、削除は使われていない版だけ押せる', () => {
    const versions = controller();
    const { container, unmount } = render(
      <IdeaVersionsCard versions={versions} fiscalYears={[fiscalYear(2024), fiscalYear(2025)]} />,
    );

    const history = rowTexts(container, 1);
    expect(history[0]).toContain('V3 有効な版');
    expect(history[2]).toContain('2024年度');
    expect(history[1]).toContain('4件');

    const deleteButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('table')[1].querySelectorAll('button'));
    // V3: 有効な版 / V2: 算定結果から参照 / V1: 2024年度に割り当て中 → どれも削除できない
    expect(deleteButtons.map((button) => button.disabled)).toEqual([true, true, true]);
    expect(deleteButtons[2].title).toContain('割り当て中');
    unmount();

    const unused = controller({
      history: { imports: IMPORTS, assignments: [], referenceCountByImportId: { 'imp-1': 0 } },
    });
    const view = render(<IdeaVersionsCard versions={unused} fiscalYears={[fiscalYear(2024)]} />);
    const v1Delete = view.container.querySelectorAll('table')[1].querySelectorAll('button')[2];
    expect(v1Delete.disabled).toBe(false);
    click(v1Delete);
    expect(unused.requestDelete).toHaveBeenCalledWith(IMPORTS[2]);
    view.unmount();
  });

  it('読込中・取込なし・読込失敗をそれぞれ案内する', () => {
    const loading = render(<IdeaVersionsCard versions={controller({ history: null })} fiscalYears={[]} />);
    expect(loading.container.textContent).toContain('取込履歴を読み込んでいます');
    loading.unmount();

    const empty = render(
      <IdeaVersionsCard
        versions={controller({ history: { imports: [], assignments: [], referenceCountByImportId: {} } })}
        fiscalYears={[fiscalYear(2024)]}
      />,
    );
    expect(empty.container.textContent).toContain('IDEAデータベースが未取込です');
    empty.unmount();

    const failed = render(
      <IdeaVersionsCard versions={controller({ loadError: '取込履歴の取得に失敗しました' })} fiscalYears={[]} />,
    );
    expect(failed.container.textContent).toContain('取込履歴の取得に失敗しました');
    failed.unmount();
  });
});
