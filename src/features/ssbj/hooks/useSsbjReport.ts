'use client';

// SSBJ レポート 1 件の読込（詳細画面）。存在しない・他組織のレポートは report = null（Not Found 表示）。
// 編集保存後の最新値（draftRevision を含む）を画面へ反映できるよう setReport を公開する。
// 状態の変更・復元のように、サーバで作業中の内容が変わった後は reload で読み直す（表示は読み直すまで前の値のまま）。

import { useEffect, useState } from 'react';
import { getSsbjReport } from '../services/reportService';
import type { SsbjReportWorkingRecord } from '../types';

export interface SsbjReportState {
  report: SsbjReportWorkingRecord | null;
  setReport: (report: SsbjReportWorkingRecord) => void;
  /** サーバから読み直す。 */
  reload: () => void;
  isLoading: boolean;
  /** 通信エラーなど（Not Found とは区別する）。 */
  errorMessage: string;
  /** 取得が終わり、エラーでもなく、該当が無かった。 */
  isNotFound: boolean;
}

export function useSsbjReport(reportId: string): SsbjReportState {
  const [report, setReport] = useState<SsbjReportWorkingRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [reloadKey, setReloadKey] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;

    getSsbjReport(reportId)
      .then(record => {
        if (isMounted) {
          setReport(record);
          setErrorMessage('');
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'SSBJレポートの取得に失敗しました');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reportId, reloadKey]);

  const isNotFound = !isLoading && !errorMessage && report === null;

  return { report, setReport, reload: () => setReloadKey(key => key + 1), isLoading, errorMessage, isNotFound };
}
