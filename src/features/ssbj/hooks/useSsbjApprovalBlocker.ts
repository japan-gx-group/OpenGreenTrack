'use client';

// レビュー中のレポートを、ログイン中の利用者が承認できない理由（自己承認）をサーバに問い合わせる（承認の案内用）。
// 作業中の内容が変わる（draftRevision が進む）と「依頼の後に変更した」かが変わりうるので、問い合わせ直す。

import { useEffect, useState } from 'react';
import { getMySsbjApprovalBlocker } from '../services/approvalBlockerService';
import type { SsbjApprovalBlocker, SsbjReportStatus } from '../types';

export interface SsbjApprovalBlockerState {
  /** 承認できない理由。レビュー中でないとき・問い合わせ中・承認してよいときは null。 */
  blocker: SsbjApprovalBlocker | null;
  errorMessage: string;
}

type Loaded = { key: string; blocker: SsbjApprovalBlocker | null; errorMessage: string };

export const useSsbjApprovalBlocker = (
  reportId: string,
  status: SsbjReportStatus,
  draftRevision: number,
): SsbjApprovalBlockerState => {
  const key = `${reportId}:${draftRevision}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (status !== 'in_review') return;
    let active = true;
    getMySsbjApprovalBlocker(reportId)
      .then(blocker => {
        if (active) setLoaded({ key, blocker, errorMessage: '' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoaded({ key, blocker: null,
          errorMessage: error instanceof Error ? error.message : '承認できるかどうかを確認できませんでした' });
      });
    return () => { active = false; };
  }, [key, reportId, status]);

  if (status !== 'in_review' || loaded === null || loaded.key !== key) {
    return { blocker: null, errorMessage: '' };
  }
  return { blocker: loaded.blocker, errorMessage: loaded.errorMessage };
};
