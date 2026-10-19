'use client';

// IDEA の版と算定年度の割り当て（係数管理画面の「IDEAの版と算定年度」カード）の状態と操作。
// 取込履歴・年度への割り当て・版ごとの参照件数の読込、年度への割り当て（または解除）、使われていない版の削除を持つ。
// 新しい版の取込・有効な版の削除は IDEA データベースカードが行うため、そのときは画面本体が reload を呼ぶ。

import { useCallback, useEffect, useState } from 'react';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import type { ShowToast } from '@/hooks/useToast';
import {
  assignIdeaImportToFiscalYear,
  deleteIdeaImport,
  fetchIdeaImportHistory,
  type IdeaImportHistory,
  type IdeaImportRecord,
} from '../services/ideaImportClient';
import { buildAssignmentMessage } from '../utils/ideaFiscalYearAssignment';

export interface IdeaVersionHistoryController {
  /** 取込履歴（読込前・失敗時は null） */
  history: IdeaImportHistory | null;
  loadError: string | null;
  reload: () => Promise<void>;
  /** 割り当てを変更中の年度（変更中はその年度の選択を無効にする） */
  pendingFiscalYearId: string | null;
  assign: (fiscalYear: FiscalYearOption, importId: string | null) => Promise<void>;
  /** 削除確認中の版 */
  importToDelete: IdeaImportRecord | null;
  isDeleting: boolean;
  requestDelete: (record: IdeaImportRecord) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
}

export function useIdeaVersionHistory(showToast: ShowToast): IdeaVersionHistoryController {
  const { refreshToken } = useAppRefresh();
  const [history, setHistory] = useState<IdeaImportHistory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingFiscalYearId, setPendingFiscalYearId] = useState<string | null>(null);
  const [importToDelete, setImportToDelete] = useState<IdeaImportRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      setHistory(await fetchIdeaImportHistory());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'IDEAデータベースの取込履歴の取得に失敗しました');
    }
  }, []);

  // 初回と「最新に更新」のたびに読み込む。アンマウント後の setState は isMounted で握りつぶす。
  useEffect(() => {
    let isMounted = true;
    fetchIdeaImportHistory()
      .then((next) => {
        if (isMounted) {
          setHistory(next);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setLoadError(error instanceof Error ? error.message : 'IDEAデータベースの取込履歴の取得に失敗しました');
        }
      });
    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  const assign = async (fiscalYear: FiscalYearOption, importId: string | null) => {
    setPendingFiscalYearId(fiscalYear.id);
    try {
      const result = await assignIdeaImportToFiscalYear(fiscalYear.id, importId);
      const imports = history?.imports ?? [];
      showToast(
        buildAssignmentMessage({
          fiscalYearLabel: fiscalYear.label,
          assignedVersion: importId === null ? null : (imports.find((record) => record.id === importId)?.version ?? ''),
          activeVersion: imports.find((record) => record.isActive)?.version ?? null,
          result,
        }),
        'success',
      );
      await reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '年度への版の割り当てに失敗しました', 'error');
    } finally {
      setPendingFiscalYearId(null);
    }
  };

  const confirmDelete = async () => {
    if (!importToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteIdeaImport(importToDelete.id);
      showToast(`IDEAデータベース ${importToDelete.version}（${importToDelete.fileName}）を削除しました`, 'success');
      setImportToDelete(null);
      await reload();
    } catch (error) {
      // 割り当て中・算定結果から参照中の 409 は理由を表示する
      setImportToDelete(null);
      showToast(error instanceof Error ? error.message : 'IDEAデータベースの削除に失敗しました', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    history,
    loadError,
    reload,
    pendingFiscalYearId,
    assign,
    importToDelete,
    isDeleting,
    requestDelete: setImportToDelete,
    cancelDelete: () => {
      if (!isDeleting) setImportToDelete(null);
    },
    confirmDelete,
  };
}
