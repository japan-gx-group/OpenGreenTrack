// OGT の候補値をレポートに採用する Server 側処理（T08b。docs/ssbj-spec.md §7・§8）。
//
// 改ざん防止: 採用する値はクライアントから受け取らない。セッションを引き継いだサーバ用クライアント（RLS あり）で
// OGT から候補値を取り直し、画面が表示していた候補値の指紋と一致したときだけ、その取り直した値を
// service_role 限定の RPC adopt_ssbj_ogt_values で保存する。一致しなければ「画面の表示から OGT の値が変わった」
// として拒否し、利用者に見ていない値を採用させない。
//
// ⚠️ サーバ専用: service_role の管理クライアント（createAdminClient）を使うため、Route Handler からのみ import すること。
// 認証・組織の確定は呼び出し元（Route Handler）が getCurrentProfile() で行う。

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ogtCandidateFingerprint } from '../utils/ogtAdoption';
import { SSBJ_LOCKED_MESSAGE, SSBJ_LOCKED_SQLSTATE } from '../utils/writeError';
import { fetchOgtCandidates } from './ogtCandidateService';
import { fetchSsbjReport } from './reportService';

/**
 * adopt_ssbj_ogt_values が使うカスタム SQLSTATE（正本は
 * supabase/migrations/20260929180243_ssbj_ogt_adoptions.sql — 変更時は両方を揃えること）。
 */
export const SSBJ_OGT_ADOPTION_SQLSTATE = {
  /** レポートが存在しない・組織不一致 */
  reportInvalid: 'P2041',
  /** 候補値の形式・年度が不正 */
  candidatesInvalid: 'P2042',
} as const;

export type SsbjOgtAdoptionFailure = 'report_not_found' | 'candidates_changed' | 'locked';

/** 採用できなかった理由（Route Handler が HTTP ステータスに変換する）。 */
export class SsbjOgtAdoptionError extends Error {
  readonly reason: SsbjOgtAdoptionFailure;

  constructor(reason: SsbjOgtAdoptionFailure, message: string) {
    super(message);
    this.name = 'SsbjOgtAdoptionError';
    this.reason = reason;
  }
}

export interface AdoptOgtCandidatesParams {
  reportId: string;
  organizationId: string;
  actorUserId: string;
  /** 画面が表示していた候補値の指紋（ogtCandidateFingerprint）。 */
  expectedFingerprint: string;
}

export const adoptOgtCandidates = async (params: AdoptOgtCandidatesParams): Promise<{ adoptedAt: string }> => {
  const supabase = await createClient();
  const report = await fetchSsbjReport(supabase, params.reportId);
  // RLS で見えない（他組織・存在しない）レポートは null。組織の一致も念のため確かめる。
  if (!report || report.organizationId !== params.organizationId) {
    throw new SsbjOgtAdoptionError('report_not_found', 'SSBJレポートが見つかりません');
  }
  // 承認済みのレポートは DB も変更を止めるが、OGT の値を取りに行く前に断る。
  if (report.review.status === 'approved') {
    throw new SsbjOgtAdoptionError('locked', SSBJ_LOCKED_MESSAGE);
  }

  const { candidates, suppliers } = await fetchOgtCandidates(supabase, report);
  if (ogtCandidateFingerprint(candidates, suppliers) !== params.expectedFingerprint) {
    throw new SsbjOgtAdoptionError(
      'candidates_changed',
      'OGT の値が画面の表示から変わりました。「最新データに更新」を押して確認してから採用してください',
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('adopt_ssbj_ogt_values', {
    p_report_id: report.id,
    p_organization_id: params.organizationId,
    p_actor_user_id: params.actorUserId,
    p_candidates: candidates,
    p_supplier_references: suppliers,
  });
  if (error) {
    if (error.code === SSBJ_OGT_ADOPTION_SQLSTATE.reportInvalid) {
      throw new SsbjOgtAdoptionError('report_not_found', 'SSBJレポートが見つかりません');
    }
    if (error.code === SSBJ_LOCKED_SQLSTATE) {
      throw new SsbjOgtAdoptionError('locked', SSBJ_LOCKED_MESSAGE);
    }
    throw new Error(`OGT の値の採用に失敗しました: ${error.message}`);
  }

  const adoptedAt = (data as { adoptedAt?: unknown } | null)?.adoptedAt;
  if (typeof adoptedAt !== 'string') {
    throw new Error('OGT の値の採用結果が不正です');
  }
  return { adoptedAt };
};
