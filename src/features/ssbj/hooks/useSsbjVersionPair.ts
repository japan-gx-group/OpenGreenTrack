'use client';

// 保存履歴の「版を比べる」で比べる 2 つの保存版の読み込み。どちらかの ID が null の間は読まない。
// 選び直したときは、前の組の内容を出したままにせず読み込み中にする（違う版どうしの差分を見せないため）。

import { useEffect, useState } from 'react';
import { getSsbjCsvVersion, type SsbjStoredVersion } from '../services/versionExportService';

export const useSsbjVersionPair = (reportId: string | null, fromId: string | null, toId: string | null) => {
  const [result, setResult] = useState<
    { key: string; before: SsbjStoredVersion | null; after: SsbjStoredVersion | null; errorMessage: string } | null
  >(null);
  const key = reportId && fromId && toId ? `${reportId}:${fromId}:${toId}` : '';

  useEffect(() => {
    if (!reportId || !fromId || !toId) return;
    let active = true;
    Promise.all([getSsbjCsvVersion(reportId, fromId), getSsbjCsvVersion(reportId, toId)])
      .then(([before, after]) => { if (active) setResult({ key, before, after, errorMessage: '' }); })
      .catch((error: unknown) => {
        if (active) {
          setResult({ key, before: null, after: null,
            errorMessage: error instanceof Error ? error.message : '保存版の取得に失敗しました' });
        }
      });
    return () => { active = false; };
  }, [reportId, fromId, toId, key]);

  const current = key && result?.key === key ? result : null;
  return {
    before: current?.before ?? null,
    after: current?.after ?? null,
    isLoading: key !== '' && current === null,
    errorMessage: current?.errorMessage ?? '',
  };
};
