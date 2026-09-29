'use client';

// レポートに採用済みの OGT の値（T08b）の読み込み。採用・取り消しの操作は useOgtAdoptionActions が持つ。

import { useEffect, useState } from 'react';
import { getOgtAdoption } from '../services/ogtAdoptionService';
import type { SsbjGhgAdoption } from '../types';

export const useOgtAdoption = (reportId: string | null) => {
  const [result, setResult] = useState<{ key: string; adoption: SsbjGhgAdoption | null; errorMessage: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const key = reportId ? `${reportId}:${reloadKey}` : '';

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    getOgtAdoption(reportId).then(adoption => {
      if (active) setResult({ key, adoption, errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ key, adoption: null,
          errorMessage: error instanceof Error ? error.message : '採用済みの値の取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [reportId, key]);

  // 採用・取り消しの後の読み直し中は直前の値を出したままにする（画面全体を読み込み中に戻さないため）。
  // 別のレポートの結果は使わない。
  const current = result && result.key.startsWith(`${reportId}:`) ? result : null;
  return {
    adoption: current?.adoption ?? null,
    isLoading: !!reportId && current === null,
    errorMessage: current?.errorMessage ?? '',
    reload: () => setReloadKey(value => value + 1),
  };
};
