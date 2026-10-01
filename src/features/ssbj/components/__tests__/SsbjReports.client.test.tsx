// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import { FICTIONAL_DRAFT_REVIEW, fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';
import type { SsbjReportWorkingRecord } from '../../types';

// SSBJ レポート一覧画面: 年度ごとの一覧表示・0 件表示・年度未登録・新規作成（検証と一覧への反映）を検証する。
// Supabase を呼ぶ I/O（一覧取得・作成）と年度 Context だけをモックする。

const fiscalYearMock = vi.hoisted(() => ({
  fiscalYearId: 'fy-2024' as string | null,
  fiscalYear: '2024',
  fiscalYears: [
    { id: 'fy-2024', label: '2024年度', year: '2024', startDate: '2024-04-01', endDate: '2025-03-31' },
  ] as FiscalYearOption[],
  isLoading: false,
  setFiscalYearId: () => {},
  refresh: async () => {},
}));

vi.mock('@/hooks/useFiscalYear', () => ({ useFiscalYear: () => fiscalYearMock }));
vi.mock('@/hooks/useAppRefresh', () => ({
  useAppRefresh: () => ({ refreshToken: 0, requestRefresh: () => {} }),
}));
vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()),
  listSsbjReports: vi.fn(),
  createSsbjReport: vi.fn(),
}));

import { createSsbjReport, listSsbjReports } from '../../services/reportService';
import { SsbjReports } from '../SsbjReports.client';

const REPORT: SsbjReportWorkingRecord = {
  ...fictionalReportBasicInfo,
  fiscalYearId: 'fy-2024',
  reportingScope: null,
  fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01',
  periodEnd: '2025-03-31',
  draftRevision: 1,
  review: FICTIONAL_DRAFT_REVIEW,
};

const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const findButton = (label: string): HTMLButtonElement => {
  const button = Array.from(document.querySelectorAll('button')).find(
    element => element.textContent?.trim() === label,
  );
  if (!button) throw new Error(`ボタンが見つかりません: ${label}`);
  return button;
};

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');

let rendered: RenderResult | null = null;

const renderScreen = async (): Promise<RenderResult> => {
  rendered = render(<SsbjReports />);
  await flushPromises();
  return rendered;
};

beforeEach(() => {
  fiscalYearMock.fiscalYearId = 'fy-2024';
  fiscalYearMock.fiscalYears = [
    { id: 'fy-2024', label: '2024年度', year: '2024', startDate: '2024-04-01', endDate: '2025-03-31' },
  ];
  vi.mocked(listSsbjReports).mockResolvedValue([]);
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.clearAllMocks();
});

describe('SsbjReports 一覧', () => {
  it('選択中の年度で一覧を取得し、レポート名から詳細へのリンクを出す', async () => {
    vi.mocked(listSsbjReports).mockResolvedValue([REPORT]);
    const { container } = await renderScreen();

    expect(listSsbjReports).toHaveBeenCalledWith('fy-2024');
    const link = container.querySelector<HTMLAnchorElement>(`a[href="/ssbj/${REPORT.id}"]`);
    expect(link?.textContent).toBe(REPORT.title);
    // 未入力の報告範囲は「未入力」と表示する（空欄・「なし」にしない）
    expect(container.textContent).toContain('未入力');
  });

  it('0 件なら年度名つきの空状態を出す', async () => {
    const { container } = await renderScreen();
    expect(container.textContent).toContain('2024年度のSSBJレポートはまだありません');
  });

  it('試行版であり準拠を保証しない旨を常に表示する', async () => {
    const { container } = await renderScreen();
    expect(container.querySelector('[role="note"]')?.textContent).toContain('準拠');
  });

  it('年度が未登録なら企業設定へ案内し、新規作成を押せない', async () => {
    fiscalYearMock.fiscalYearId = null;
    fiscalYearMock.fiscalYears = [];
    const { container } = await renderScreen();

    expect(container.textContent).toContain('算定年度が登録されていません');
    expect(findButton('新規作成').disabled).toBe(true);
    expect(listSsbjReports).not.toHaveBeenCalled();
  });
});

describe('SsbjReports 新規作成', () => {
  it('入力を正規化して選択中の年度に作成し、一覧へ反映してダイアログを閉じる', async () => {
    const created: SsbjReportWorkingRecord = { ...REPORT, id: '5b1f0000-0000-4000-8000-0000000000aa', title: '新しいレポート' };
    vi.mocked(createSsbjReport).mockResolvedValue(created);
    const { container } = await renderScreen();

    click(findButton('新規作成'));
    expect(dialog()?.textContent).toContain('対象年度: 2024年度');

    const titleInput = dialog()?.querySelector<HTMLInputElement>('input[name="title"]');
    if (!titleInput) throw new Error('レポート名の入力欄がありません');
    setInputValue(titleInput, '  新しいレポート  ');
    click(findButton('作成する'));
    await flushPromises();

    expect(createSsbjReport).toHaveBeenCalledWith('fy-2024', {
      title: '新しいレポート',
      purpose: null,
      reportingScope: null,
      standardVersion: null,
      parentCompanyName: null,
      parentRelationship: null,
      ownershipPercentage: null,
      measurementApproach: null,
      industryCode: null,
    });
    expect(container.querySelector(`a[href="/ssbj/${created.id}"]`)?.textContent).toBe('新しいレポート');
    expect(dialog()).toBeNull();
  });

  it('レポート名が空白だけなら作成せず、エラーを表示する', async () => {
    await renderScreen();

    click(findButton('新規作成'));
    const titleInput = dialog()?.querySelector<HTMLInputElement>('input[name="title"]');
    if (!titleInput) throw new Error('レポート名の入力欄がありません');
    setInputValue(titleInput, '   ');
    click(findButton('作成する'));
    await flushPromises();

    expect(createSsbjReport).not.toHaveBeenCalled();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('レポート名を入力してください');
  });

  it('作成に失敗したらダイアログを開いたままエラーを表示する', async () => {
    vi.mocked(createSsbjReport).mockRejectedValue(new Error('SSBJレポートの作成に失敗しました'));
    await renderScreen();

    click(findButton('新規作成'));
    const titleInput = dialog()?.querySelector<HTMLInputElement>('input[name="title"]');
    if (!titleInput) throw new Error('レポート名の入力欄がありません');
    setInputValue(titleInput, 'レポート');
    click(findButton('作成する'));
    await flushPromises();

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('SSBJレポートの作成に失敗しました');
  });
});
