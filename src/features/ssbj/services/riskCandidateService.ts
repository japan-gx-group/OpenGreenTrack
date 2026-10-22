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
import { throwIfSsbjEditForbidden } from './memberRoleService';
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
 * 画面で未検討の候補への判断（除外）を記録する。作るだけで、既にある判断は更新しない。
 * 古い画面から既にある判断を上書きすると、採用の関連付けが外れて、再採用で同じリスク・機会が重複して登録されるため。
 * 他の画面で先に判断されていれば（レポートと候補の組の一意制約）、開き直しを促す。
 */
export const createSsbjRiskCandidateDecision = async (
  report: { id: string; organizationId: string },
  input: SsbjRiskCandidateDecisionInput,
): Promise<SsbjRiskCandidateDecision> => {
  const { data, error } = await createClient()
    .from('ssbj_risk_candidate_decisions')
    .insert({ ...input, reportId: report.id, organizationId: report.organizationId })
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      throw new Error('この候補は他の画面で先に判断されました。画面を開き直してください');
    }
    throw new Error(ssbjWriteErrorMessage(error, '候補への判断の保存に失敗しました'));
  }
  return toSsbjRiskCandidateDecision(data as SsbjRiskCandidateDecisionRow);
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
 * target.updatedAt は画面が読み込んだ時点の判断の更新日時。削除の条件に含め、他の画面で先に変えた判断を消さない
 * （riskOpportunityService.ts の updateSsbjRiskOpportunity と同じ）。
 * 登録したリスク・機会が残っている採用は、RLS が削除させない（0 行になる。再採用で重複して登録されるのを防ぐ）。
 * どちらの場合も削除した行数で確かめて、開き直しを促す。
 */
export const deleteSsbjRiskCandidateDecision = async (
  reportId: string,
  target: Pick<SsbjRiskCandidateDecision, 'candidateId' | 'updatedAt'>,
): Promise<void> => {
  const { data, error } = await createClient()
    .from('ssbj_risk_candidate_decisions')
    .delete()
    .eq('reportId', reportId)
    .eq('candidateId', target.candidateId)
    .eq('updatedAt', target.updatedAt)
    .select('candidateId');
  if (error) throw new Error(ssbjWriteErrorMessage(error, '候補への判断の取り消しに失敗しました'));
  if ((data ?? []).length === 0) {
    // ロールで止められた削除もエラーにならず 0 行になる。今も編集できるかを確かめ、できなければ権限のメッセージにする。
    await throwIfSsbjEditForbidden();
    throw new Error(
      '他の画面で変更されたため、未検討に戻していません。画面を開き直してください（登録したリスク・機会が残っている採用は、先にそれを削除すると戻せます）',
    );
  }
};
