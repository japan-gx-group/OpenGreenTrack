'use client';

// 最新のレビュー依頼の日時の読み込み（保存履歴の「版を比べる」の既定の版を決めるため）。reportId が null の間は読まない。
// 読めなかったときは依頼の時点が分からないものとして null を返す（比べる版は 1 つ前の版 → 最新の版にする）。
// loadKey が変わるたびに読み直す（「版を比べる」を開くたびに、その時点の最新の依頼で決めるため）。

import { useEffect, useState } from 'react';
import { getLatestSsbjReviewRequestAt } from '../services/auditLogService';

export const useSsbjLatestReviewRequest = (reportId: string | null, loadKey: number) => {
  const [result, setResult] = useState<{ key: string; requestedAt: string | null } | null>(null);
  const key = reportId ? `${reportId}:${loadKey}` : '';

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    getLatestSsbjReviewRequestAt(reportId)
      .then(requestedAt => { if (active) setResult({ key, requestedAt }); })
      .catch(() => { if (active) setResult({ key, requestedAt: null }); });
    return () => { active = false; };
  }, [reportId, key]);

  const current = key && result?.key === key ? result : null;
  return {
    requestedAt: current?.requestedAt ?? null,
    isLoading: key !== '' && current === null,
  };
};
