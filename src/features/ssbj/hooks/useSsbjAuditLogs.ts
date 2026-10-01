'use client';

// レポートの操作履歴（新しい順）の読み込み。出力のように履歴が増える操作の後は reload で読み直す。

import { useEffect, useState } from 'react';
import { listSsbjAuditLogs } from '../services/auditLogService';
import type { SsbjAuditLog } from '../types';

export const useSsbjAuditLogs = (reportId: string | null) => {
  const [result, setResult] = useState<{ key: string; logs: SsbjAuditLog[]; errorMessage: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const key = reportId ? `${reportId}:${reloadKey}` : null;

  useEffect(() => {
    if (!reportId || !key) return;
    let active = true;
    listSsbjAuditLogs(reportId).then(logs => {
      if (active) setResult({ key, logs, errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ key, logs: [], errorMessage: error instanceof Error ? error.message : '操作履歴の取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [reportId, key]);

  // 読み直しの間は前の一覧を出したままにする（画面がちらつかないように）。
  const current = result;
  return {
    logs: current?.logs ?? [],
    isLoading: !!reportId && current === null,
    errorMessage: current?.errorMessage ?? '',
    reload: () => setReloadKey(value => value + 1),
  };
};
