'use client';

// レビューを依頼する前の点検表（utils/reviewChecklist.ts）の行を組み立てる。数は画面の上のタブと同じ進み具合
// （SsbjReportOverviewProvider が数えたもの）を使い、採用した OGT の値の変化を見るためだけに OGT の最新の値を読む。
// report が null（作成中でない・依頼できない人・閲覧者）のときは何も読まない。

import { useMemo } from 'react';
import type { SsbjReportRecord } from '../types';
import { changedOgtValueLabels } from '../utils/ogtAdoption';
import { ssbjConflicts, ssbjReviewChecklist, type SsbjChecklistRow, type SsbjOgtChangeState } from '../utils/reviewChecklist';
import { useOgtCandidates } from './useOgtCandidates';
import type { SsbjReportProgressState } from './useSsbjReportProgress';

export const useSsbjReviewChecklist = (
  report: SsbjReportRecord | null,
  progress: SsbjReportProgressState | null,
): { rows: SsbjChecklistRow[] | null; isLoading: boolean; errorMessage: string } => {
  const counted = progress?.progress ?? null;
  const sections = progress?.sections ?? null;
  const adoption = report ? sections?.ghg ?? null : null;
  // 採用していなければ、比べる相手が無いので OGT の値を読まない。
  const ogt = useOgtCandidates(adoption ? report : null);
  const rows = useMemo(() => {
    if (!report || !counted || !sections) return null;
    const ogtState: SsbjOgtChangeState = !adoption
      ? { adopted: false }
      : {
        adopted: true,
        isLoading: ogt.isLoading,
        changedLabels: ogt.data ? changedOgtValueLabels(adoption, ogt.data.candidates, ogt.data.suppliers) : null,
      };
    return ssbjReviewChecklist({ progress: counted, conflicts: ssbjConflicts(sections), ogt: ogtState });
  }, [report, counted, sections, adoption, ogt.data, ogt.isLoading]);
  return {
    rows,
    isLoading: !!report && (!!progress?.isLoading || ogt.isLoading),
    // OGT の値を読めないときは、その行を「比べられなかった」にするだけで、点検表は出す。
    errorMessage: report ? progress?.errorMessage ?? '' : '',
  };
};
