'use client';

// 業種から出したリスク・機会の候補への判断の読込と、判断の保存・取り消し。
// 候補そのものは utils/industryCandidates.ts の定数で、ここはレポートごとの判断だけを扱う。
// レポート自体が見つからない間（enabled = false）は読み込まない。

import { useEffect, useState } from 'react';
import {
  adoptSsbjRiskCandidate,
  deleteSsbjRiskCandidateDecision,
  listSsbjRiskCandidateDecisions,
  saveSsbjRiskCandidateDecision,
} from '../services/riskCandidateService';
import type { SsbjRiskCandidateDecision, SsbjRiskOpportunityWorkingRecord } from '../types';
import {
  SSBJ_INDUSTRY_CANDIDATE_VERSION,
  normalizeSsbjRiskCandidateDecision,
  validateSsbjRiskCandidateDecision,
  type SsbjIndustryCandidate,
  type SsbjRiskCandidateDecisionInput,
} from '../utils/industryCandidates';
import type { SsbjRiskOpportunityInput } from '../utils/riskOpportunity';

export interface SsbjRiskCandidatesState {
  decisions: SsbjRiskCandidateDecision[];
  isLoading: boolean;
  errorMessage: string;
  /** 判断を検証して保存する。検証・保存のエラーは例外にする（呼び出し側が画面に出す）。 */
  decide: (report: { id: string; organizationId: string }, input: SsbjRiskCandidateDecisionInput) => Promise<void>;
  /** 候補を採用してリスク・機会を登録する（登録と採用の記録は一緒に保存され、片方だけ残らない）。登録したリスク・機会を返す。 */
  adopt: (reportId: string, candidate: SsbjIndustryCandidate, input: SsbjRiskOpportunityInput) => Promise<SsbjRiskOpportunityWorkingRecord>;
  /** 判断を取り消して未検討に戻す（登録したリスク・機会が残っている採用は取り消せない）。 */
  undo: (reportId: string, candidateId: string) => Promise<void>;
}

export function useSsbjRiskCandidates(reportId: string, enabled: boolean): SsbjRiskCandidatesState {
  const [decisions, setDecisions] = useState<SsbjRiskCandidateDecision[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (!enabled) return;
    let isMounted = true;
    listSsbjRiskCandidateDecisions(reportId)
      .then(list => {
        if (isMounted) {
          setDecisions(list);
          setErrorMessage('');
        }
      })
      .catch((error: unknown) => {
        if (isMounted) setErrorMessage(error instanceof Error ? error.message : '候補への判断の取得に失敗しました');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [reportId, enabled]);

  const decide: SsbjRiskCandidatesState['decide'] = async (report, input) => {
    const normalized = normalizeSsbjRiskCandidateDecision(input);
    const errors = validateSsbjRiskCandidateDecision(normalized);
    if (errors.length > 0) throw new Error(errors.join('。'));
    const saved = await saveSsbjRiskCandidateDecision(report, normalized);
    setDecisions(prev => [...prev.filter(decision => decision.candidateId !== saved.candidateId), saved]);
  };

  const adopt: SsbjRiskCandidatesState['adopt'] = async (targetReportId, candidate, input) => {
    const { riskOpportunity, decision: saved } = await adoptSsbjRiskCandidate(
      targetReportId,
      { candidateId: candidate.id, candidateVersion: SSBJ_INDUSTRY_CANDIDATE_VERSION },
      input,
    );
    setDecisions(prev => [...prev.filter(decision => decision.candidateId !== saved.candidateId), saved]);
    return riskOpportunity;
  };

  const undo: SsbjRiskCandidatesState['undo'] = async (targetReportId, candidateId) => {
    await deleteSsbjRiskCandidateDecision(targetReportId, candidateId);
    setDecisions(prev => prev.filter(decision => decision.candidateId !== candidateId));
  };

  return { decisions, isLoading, errorMessage, decide, adopt, undo };
}
