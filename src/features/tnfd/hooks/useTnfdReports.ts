'use client';

// TNFD レポート一覧の読込。ヘッダーで選択中の年度が変わったとき・更新ボタン（refreshToken）で再取得する。
// 作成ダイアログで作ったレポートは再取得を待たずに先頭へ差し込めるよう addReport を公開する。

import { useCallback, useEffect, useState } from 'react';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import type { ShowToast } from '@/hooks/useToast';
import { listTnfdReports } from '../services/reportService';
import type { TnfdReportRecord } from '../types';

export interface TnfdReportsState {
  /** 選択中の年度のレポートだけ（年度切替直後に前の年度の行が混ざらないよう絞ってから返す）。 */
  reports: TnfdReportRecord[];
  /** 取得中（初回・年度切替・更新ボタン）。 */
  isLoading: boolean;
  /** 1 回でも取得が終わったか（取得前の空一覧を「0 件」と誤表示しないため）。 */
  hasFetchedOnce: boolean;
  addReport: (report: TnfdReportRecord) => void;
}

export function useTnfdReports(fiscalYearId: string | null, showToast: ShowToast): TnfdReportsState {
  const { refreshToken } = useAppRefresh();
  const [allReports, setAllReports] = useState<TnfdReportRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasFetchedOnce, setHasFetchedOnce] = useState<boolean>(false);

  useEffect(() => {
    // 年度の読込前（FiscalYearContext のロード中・年度未登録）は取得しない。
    if (!fiscalYearId) return;

    let isMounted = true;
    // effect 本体での同期的な setState は lint（set-state-in-effect）で禁止されているため、
    // ローディング表示の開始は setTimeout(0) のコールバックへ逃がす（useSsbjReports と同じ）。
    const loadingTimer = setTimeout(() => {
      if (isMounted) setIsLoading(true);
    }, 0);
    listTnfdReports(fiscalYearId)
      .then(reports => {
        if (isMounted) setAllReports(reports);
      })
      .catch(() => {
        if (isMounted) showToast('TNFDレポートの取得に失敗しました', 'error');
      })
      .finally(() => {
        clearTimeout(loadingTimer);
        if (isMounted) {
          setIsLoading(false);
          setHasFetchedOnce(true);
        }
      });

    return () => {
      isMounted = false;
      clearTimeout(loadingTimer);
    };
  }, [fiscalYearId, refreshToken, showToast]);

  const addReport = useCallback((report: TnfdReportRecord) => {
    setAllReports(prev => [report, ...prev.filter(existing => existing.id !== report.id)]);
  }, []);

  const reports = allReports.filter(report => report.fiscalYearId === fiscalYearId);

  return { reports, isLoading, hasFetchedOnce, addReport };
}
