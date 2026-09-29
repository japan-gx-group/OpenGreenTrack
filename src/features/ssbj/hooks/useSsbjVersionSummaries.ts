'use client';

// レポートの保存版の一覧（新しい順）の読み込み。プレビューで表示する版を選ぶために使う。

import { useEffect, useState } from 'react';
import { listSsbjVersions, type SsbjVersionSummary } from '../services/versionExportService';

export const useSsbjVersionSummaries = (reportId: string | null) => {
  const [result, setResult] = useState<{ reportId: string; versions: SsbjVersionSummary[]; errorMessage: string } | null>(null);

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    listSsbjVersions(reportId).then(versions => {
      if (active) setResult({ reportId, versions, errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ reportId, versions: [],
          errorMessage: error instanceof Error ? error.message : '保存履歴の取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [reportId]);

  const current = result?.reportId === reportId ? result : null;
  return {
    versions: current?.versions ?? [],
    isLoading: !!reportId && current === null,
    errorMessage: current?.errorMessage ?? '',
  };
};
