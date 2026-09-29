'use client';

import { useEffect, useState } from 'react';
import { getOgtCandidates, type OgtCandidateData } from '../services/ogtCandidateService';
import type { SsbjReportRecord } from '../types';

export const useOgtCandidates = (report: SsbjReportRecord | null) => {
  const [result, setResult] = useState<{ key: string; data: OgtCandidateData | null; errorMessage: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const key = report ? `${report.id}:${refreshKey}` : '';

  useEffect(() => {
    if (!report) return;
    let active = true;
    getOgtCandidates(report).then(result => {
      if (active) setResult({ key, data: result, errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ key, data: null,
          errorMessage: error instanceof Error ? error.message : 'OGT 候補値の取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [report, key]);

  return { data: result?.key === key ? result.data : null,
    isLoading: !!report && result?.key !== key,
    errorMessage: result?.key === key ? result.errorMessage : '',
    refresh: () => setRefreshKey(value => value + 1) };
};
