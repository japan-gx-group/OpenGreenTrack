// 業種から出したリスク・機会の候補への判断（ssbj_risk_candidate_decisions。レポートと候補の組ごとに 1 行）の取得・保存・削除。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。組織分離は RLS が強制する。
// 判断は作業用の記録で、保存版には含めない（docs/ssbj-spec.md §13「業種から出す候補」）。

import { createClient } from '@/lib/supabase/client';
import {
  SSBJ_RISK_CANDIDATE_DECISIONS,
  type SsbjRiskCandidateDecision,
  type SsbjRiskCandidateDecisionKind,
  type SsbjRiskOpportunityWorkingRecord,
} from '../types';
import type { SsbjRiskCandidateDecisionInput } from '../utils/industryCandidates';
import type { SsbjRiskOpportunityInput } from '../utils/riskOpportunity';
import { ssbjWriteErrorMessage } from '../utils/writeError';
import {
  toSsbjRiskOpportunityColumns,
  toSsbjRiskOpportunityWorkingRecord,
  type SsbjRiskOpportunityWorkingRow,
} from './riskOpportunityService';

type SsbjRiskCandidateDecisionRow = {
  candidateId: string;
  candidateVersion: string;
  industryCode: string | null;
  decision: string;
  reason: string | null;
  riskOpportunityId: string | null;
  updatedAt: string;
};

const SELECT_COLUMNS = 'candidateId, candidateVersion, industryCode, decision, reason, riskOpportunityId, updatedAt';

const isDecisionKind = (value: string): value is SsbjRiskCandidateDecisionKind =>
  (SSBJ_RISK_CANDIDATE_DECISIONS as readonly string[]).includes(value);

/** DB 行 → 判断。判断の種類は DB の check 制約が保証しているが、食い違えば黙って補正せず例外にする。 */
export const toSsbjRiskCandidateDecision = (row: SsbjRiskCandidateDecisionRow): SsbjRiskCandidateDecision => {
  if (!isDecisionKind(row.decision)) throw new Error(`不明な候補の判断です: ${row.decision}`);
  return { ...row, decision: row.decision };
};

/** レポートの候補への判断（候補 ID の順）。 */
export const listSsbjRiskCandidateDecisions = async (reportId: string): Promise<SsbjRiskCandidateDecision[]> => {
  const { data, error } = await createClient()
    .from('ssbj_risk_candidate_decisions')
    .select(SELECT_COLUMNS)
    .eq('reportId', reportId)
    .order('candidateId');
  if (error) throw new Error('候補への判断の取得に失敗しました');
  return ((data ?? []) as SsbjRiskCandidateDecisionRow[]).map(toSsbjRiskCandidateDecision);
};

/**
 * 候補 1 件への判断を保存する。行があれば更新し、無ければ作る
 * （upsert にしないのは、作成後に変えない列を update の列 GRANT に入れていないため。narrativeService.ts と同じ）。
 */
export const saveSsbjRiskCandidateDecision = async (
  report: { id: string; organizationId: string },
  input: SsbjRiskCandidateDecisionInput,
): Promise<SsbjRiskCandidateDecision> => {
  const supabase = createClient();
  const { candidateId, ...columns } = input;

  const updated = await supabase
    .from('ssbj_risk_candidate_decisions')
    .update(columns)
    .eq('reportId', report.id)
    .eq('candidateId', candidateId)
    .select(SELECT_COLUMNS);
  if (updated.error) throw new Error(ssbjWriteErrorMessage(updated.error, '候補への判断の保存に失敗しました'));
  const updatedRows = (updated.data ?? []) as SsbjRiskCandidateDecisionRow[];
  if (updatedRows.length > 0) return toSsbjRiskCandidateDecision(updatedRows[0]);

  const inserted = await supabase
    .from('ssbj_risk_candidate_decisions')
    .insert({ ...columns, candidateId, reportId: report.id, organizationId: report.organizationId })
    .select(SELECT_COLUMNS)
    .single();
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') {
      throw new Error('他の画面で先に保存されました。画面を開き直してから保存し直してください');
    }
    throw new Error(ssbjWriteErrorMessage(inserted.error, '候補への判断の保存に失敗しました'));
  }
  return toSsbjRiskCandidateDecision(inserted.data as SsbjRiskCandidateDecisionRow);
};

/** 同じ候補が既に採用されているときに、adopt_ssbj_risk_candidate が返す SQLSTATE。 */
export const SSBJ_CANDIDATE_ALREADY_ADOPTED_SQLSTATE = 'P2062';

/**
 * 候補を採用して、リスク・機会を登録する。登録と採用の記録は RPC の中で 1 つのトランザクションで保存し、
 * どちらかが失敗すれば両方とも残らない（登録だけ残って、もう一度採用すると重複して登録される経路を作らないため）。
 * 業種は DB がレポートの基本情報から記録する。
 */
export const adoptSsbjRiskCandidate = async (
  reportId: string,
  candidate: { candidateId: string; candidateVersion: string },
  input: SsbjRiskOpportunityInput,
): Promise<{ riskOpportunity: SsbjRiskOpportunityWorkingRecord; decision: SsbjRiskCandidateDecision }> => {
  const { data, error } = await createClient().rpc('adopt_ssbj_risk_candidate', {
    p_report_id: reportId,
    p_candidate_id: candidate.candidateId,
    p_candidate_version: candidate.candidateVersion,
    p_risk: toSsbjRiskOpportunityColumns(input),
  });
  if (error || !data) {
    if (error?.code === SSBJ_CANDIDATE_ALREADY_ADOPTED_SQLSTATE) {
      throw new Error('この候補は他の画面で先に採用されました。画面を開き直してください');
    }
    throw new Error(ssbjWriteErrorMessage(error, '候補を採用して登録できませんでした（リスク・機会も登録していません）'));
  }
  // 登録したリスク・機会は updatedAt 付きで返る（一覧から続けて編集するときの競合検知に使う）。
  const result = data as { riskOpportunity: SsbjRiskOpportunityWorkingRow; decision: SsbjRiskCandidateDecisionRow };
  return {
    riskOpportunity: toSsbjRiskOpportunityWorkingRecord(result.riskOpportunity),
    decision: toSsbjRiskCandidateDecision(result.decision),
  };
};

/**
 * 候補への判断を取り消す（未検討に戻す）。登録したリスク・機会は消さない。
 * 登録したリスク・機会が残っている採用は、RLS が削除させない（0 行になる。再採用で重複して登録されるのを防ぐ）ので、
 * 削除した行数で確かめて、先にリスク・機会を削除するよう伝える。
 */
export const deleteSsbjRiskCandidateDecision = async (reportId: string, candidateId: string): Promise<void> => {
  const { data, error } = await createClient()
    .from('ssbj_risk_candidate_decisions')
    .delete()
    .eq('reportId', reportId)
    .eq('candidateId', candidateId)
    .select('candidateId');
  if (error) throw new Error(ssbjWriteErrorMessage(error, '候補への判断の取り消しに失敗しました'));
  if ((data ?? []).length === 0) {
    throw new Error('登録したリスク・機会が残っているため、未検討に戻せません。先にそのリスク・機会を削除してください（または画面を開き直してください）');
  }
};
