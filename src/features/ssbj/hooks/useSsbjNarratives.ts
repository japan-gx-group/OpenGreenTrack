'use client';

// レポートの四本柱・補足の文章（T05）の読み込みと、保存後の差し替え。編集フォームは useSsbjNarrativeForm が持つ。

import { useEffect, useState } from 'react';
import { listSsbjNarratives } from '../services/narrativeService';
import type { SsbjNarrative } from '../types';

export const useSsbjNarratives = (reportId: string | null) => {
  const [result, setResult] = useState<{ reportId: string; narratives: SsbjNarrative[]; errorMessage: string } | null>(null);

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    listSsbjNarratives(reportId).then(narratives => {
      if (active) setResult({ reportId, narratives, errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ reportId, narratives: [],
          errorMessage: error instanceof Error ? error.message : '四本柱の文章の取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [reportId]);

  const current = result?.reportId === reportId ? result : null;

  /** 保存した 1 項目を一覧へ反映する（読み直さずに済ませる）。 */
  const replace = (saved: SsbjNarrative) => {
    setResult(prev => prev && {
      ...prev,
      narratives: [...prev.narratives.filter(narrative => narrative.itemId !== saved.itemId), saved]
        .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)),
    });
  };

  return {
    narratives: current?.narratives ?? [],
    isLoading: !!reportId && current === null,
    errorMessage: current?.errorMessage ?? '',
    replace,
  };
};
