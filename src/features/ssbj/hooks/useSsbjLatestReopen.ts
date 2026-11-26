'use client';

// 最新の差戻し（理由・誰が・いつ）の読み込み。作成中に戻った理由を、レポートの中の画面の上に出すのに使う。
// reportId が null（閲覧者など、操作履歴を見られない人）のときは読まない。状態を変えた後は reload で読み直す。

import { useEffect, useState } from 'react';
import { getLatestSsbjStatusChange } from '../services/auditLogService';
import { ssbjReopenNotice, type SsbjReopenNotice } from '../utils/auditLog';

export const useSsbjLatestReopen = (reportId: string | null) => {
  const [result, setResult] = useState<{ key: string; notice: SsbjReopenNotice | null; errorMessage: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const key = reportId ? `${reportId}:${reloadKey}` : '';

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    getLatestSsbjStatusChange(reportId).then(log => {
      if (active) setResult({ key, notice: ssbjReopenNotice(log), errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ key, notice: null, errorMessage: error instanceof Error ? error.message : '差戻しの理由の取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [reportId, key]);

  const current = result?.key === key ? result : null;
  return {
    notice: current?.notice ?? null,
    isLoading: !!reportId && current === null,
    errorMessage: current?.errorMessage ?? '',
    reload: () => setReloadKey(value => value + 1),
  };
};
