'use client';

// TNFD レポート 1 件の読込（詳細画面）。存在しない・他組織のレポートは report = null（Not Found 表示）。
// 編集保存後の最新値を画面へ反映できるよう setReport を公開する。

import { useEffect, useState } from 'react';
import { getTnfdReport } from '../services/reportService';
import type { TnfdReportRecord } from '../types';

export interface TnfdReportState {
  report: TnfdReportRecord | null;
  setReport: (report: TnfdReportRecord) => void;
  isLoading: boolean;
  /** 通信エラーなど（Not Found とは区別する）。 */
  errorMessage: string;
  /** 取得が終わり、エラーでもなく、該当が無かった。 */
  isNotFound: boolean;
}

export function useTnfdReport(reportId: string): TnfdReportState {
  const [report, setReport] = useState<TnfdReportRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let isMounted = true;

    getTnfdReport(reportId)
      .then(record => {
        if (isMounted) {
          setReport(record);
          setErrorMessage('');
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'TNFDレポートの取得に失敗しました');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reportId]);

  const isNotFound = !isLoading && !errorMessage && report === null;

  return { report, setReport, isLoading, errorMessage, isNotFound };
}
