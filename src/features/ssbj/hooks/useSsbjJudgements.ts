'use client';

// レポートの該当性・重要性の判断（T09）の読み込みと、保存後の差し替え。編集フォームは useSsbjJudgementForm が持つ。

import { useEffect, useState } from 'react';
import { listSsbjJudgements } from '../services/judgementService';
import type { SsbjJudgement } from '../types';

export const useSsbjJudgements = (reportId: string | null) => {
  const [result, setResult] = useState<{ reportId: string; judgements: SsbjJudgement[]; errorMessage: string } | null>(null);

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    listSsbjJudgements(reportId).then(judgements => {
      if (active) setResult({ reportId, judgements, errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ reportId, judgements: [],
          errorMessage: error instanceof Error ? error.message : '該当性・重要性の判断の取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [reportId]);

  const current = result?.reportId === reportId ? result : null;

  /** 保存した 1 要求の判断を一覧へ反映する（読み直さずに済ませる）。 */
  const replace = (saved: SsbjJudgement) => {
    setResult(prev => prev && {
      ...prev,
      judgements: [...prev.judgements.filter(judgement => judgement.requirementId !== saved.requirementId), saved]
        .sort((a, b) => (a.requirementId < b.requirementId ? -1 : a.requirementId > b.requirementId ? 1 : 0)),
    });
  };

  return {
    judgements: current?.judgements ?? [],
    isLoading: !!reportId && current === null,
    errorMessage: current?.errorMessage ?? '',
    replace,
  };
};
