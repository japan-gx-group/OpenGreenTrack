'use client';

// レポートの該当性・重要性の判断（T09）の読み込みと、保存後の差し替え・読み直し。編集フォームは useSsbjJudgementForm が持つ。

import { useEffect, useState } from 'react';
import { listSsbjJudgements, type SsbjJudgementWorkingRecord } from '../services/judgementService';

export const useSsbjJudgements = (reportId: string | null) => {
  const [result, setResult] = useState<
    { reportId: string; judgements: SsbjJudgementWorkingRecord[]; errorMessage: string } | null
  >(null);
  // 読み直しの合図（増やすと再取得する）。読み直しの間も今の一覧は出したままにする。
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [reportId, reloadKey]);

  const current = result?.reportId === reportId ? result : null;

  /** 保存した 1 要求の判断を一覧へ反映する（読み直さずに済ませる）。 */
  const replace = (saved: SsbjJudgementWorkingRecord) => {
    setResult(prev => prev && {
      ...prev,
      judgements: [...prev.judgements.filter(judgement => judgement.requirementId !== saved.requirementId), saved]
        .sort((a, b) => (a.requirementId < b.requirementId ? -1 : a.requirementId > b.requirementId ? 1 : 0)),
    });
  };

  /** 他の画面で保存された最新の判断を読み直す（一覧から保存しようとして競合したとき）。 */
  const reload = () => setReloadKey(key => key + 1);

  return {
    judgements: current?.judgements ?? [],
    isLoading: !!reportId && current === null,
    errorMessage: current?.errorMessage ?? '',
    replace,
    reload,
  };
};
