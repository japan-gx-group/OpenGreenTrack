// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import {
  assignIdeaImportToFiscalYear,
  deleteIdeaImport,
  fetchIdeaImportHistory,
  type IdeaImportHistory,
  type IdeaImportRecord,
} from '../../services/ideaImportClient';
import { useIdeaVersionHistory, type IdeaVersionHistoryController } from '../useIdeaVersionHistory';

// 「IDEAの版と算定年度」カードの状態と操作: 読込・年度への割り当て（通知と読み直し）・使われていない版の削除。

vi.mock('../../services/ideaImportClient', () => ({
  fetchIdeaImportHistory: vi.fn(),
  assignIdeaImportToFiscalYear: vi.fn(),
  deleteIdeaImport: vi.fn(),
}));

vi.mock('@/hooks/useAppRefresh', () => ({
  useAppRefresh: () => ({ refreshToken: 0, requestRefresh: vi.fn() }),
}));

const record = (overrides: Partial<IdeaImportRecord>): IdeaImportRecord => ({
  id: 'imp-1',
  version: 'V1',
  releaseDate: null,
  gwpModel: 'GWP100',
  citationText: '',
  fileName: 'v1.xlsx',
  status: 'completed',
  rowCount: 10,
  isActive: false,
  unmappedRecordCount: 0,
  skippedRowCount: 0,
  errorMessage: null,
  createdAt: '2025-05-01T00:00:00Z',
  ...overrides,
});

const HISTORY: IdeaImportHistory = {
  imports: [record({ id: 'imp-2', version: 'V2', isActive: true }), record({})],
  assignments: [],
  referenceCountByImportId: { 'imp-2': 0, 'imp-1': 0 },
};

const FY2024: FiscalYearOption = { id: 'fy-2024', label: '2024年度', year: '2024', startDate: '2024-04-01', endDate: '2025-03-31' };

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const renderHook = (showToast = vi.fn()) => {
  const ref: { current: IdeaVersionHistoryController | null } = { current: null };
  const Probe = () => {
    ref.current = useIdeaVersionHistory(showToast);
    return null;
  };
  const view = render(<Probe />);
  return { ref, showToast, view };
};

describe('useIdeaVersionHistory', () => {
  beforeEach(() => {
    vi.mocked(fetchIdeaImportHistory).mockResolvedValue(HISTORY);
  });
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('最初に取込履歴を読み込む', async () => {
    const { ref, view } = renderHook();
    await flush();
    expect(ref.current?.history).toEqual(HISTORY);
    view.unmount();
  });

  it('年度に版を割り当てると、版の表記と付け替えの件数を通知して読み直す', async () => {
    vi.mocked(assignIdeaImportToFiscalYear).mockResolvedValue({ importId: 'imp-1', remappedCount: 2, unmappedCount: 0 });
    const { ref, showToast, view } = renderHook();
    await flush();

    await act(async () => {
      await ref.current?.assign(FY2024, 'imp-1');
    });

    expect(assignIdeaImportToFiscalYear).toHaveBeenCalledWith('fy-2024', 'imp-1');
    expect(showToast).toHaveBeenCalledWith(
      '2024年度に V1 を割り当てました。\nこの年度の未算定のデータ 2 件を、この版の製品に付け替えました。',
      'success',
    );
    expect(fetchIdeaImportHistory).toHaveBeenCalledTimes(2);
    expect(ref.current?.pendingFiscalYearId).toBeNull();
    view.unmount();
  });

  it('割り当てに失敗したらサーバーの文言で通知する', async () => {
    vi.mocked(assignIdeaImportToFiscalYear).mockRejectedValue(new Error('会計年度が見つかりません'));
    const { ref, showToast, view } = renderHook();
    await flush();

    await act(async () => {
      await ref.current?.assign(FY2024, null);
    });

    expect(showToast).toHaveBeenCalledWith('会計年度が見つかりません', 'error');
    view.unmount();
  });

  it('削除の確認で「削除する」を押すと削除して読み直し、失敗（割り当て中など）は理由を通知する', async () => {
    const { ref, showToast, view } = renderHook();
    await flush();

    act(() => ref.current?.requestDelete(HISTORY.imports[1]));
    expect(ref.current?.importToDelete).toEqual(HISTORY.imports[1]);
    vi.mocked(deleteIdeaImport).mockResolvedValueOnce();
    await act(async () => {
      await ref.current?.confirmDelete();
    });
    expect(deleteIdeaImport).toHaveBeenCalledWith('imp-1');
    expect(showToast).toHaveBeenLastCalledWith('IDEAデータベース V1（v1.xlsx）を削除しました', 'success');
    expect(ref.current?.importToDelete).toBeNull();

    act(() => ref.current?.requestDelete(HISTORY.imports[1]));
    vi.mocked(deleteIdeaImport).mockRejectedValueOnce(new Error('算定年度に割り当てられているため削除できません'));
    await act(async () => {
      await ref.current?.confirmDelete();
    });
    expect(showToast).toHaveBeenLastCalledWith('算定年度に割り当てられているため削除できません', 'error');
    expect(ref.current?.importToDelete).toBeNull();
    view.unmount();
  });
});
