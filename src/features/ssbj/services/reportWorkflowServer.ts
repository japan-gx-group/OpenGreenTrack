// SSBJ レポートの状態の変更（レビュー依頼・承認・差戻し）と、保存版の復元を行う Server 側処理（docs/ssbj-spec.md §13）。
// どちらも service_role 限定の RPC（change_ssbj_report_status / restore_ssbj_report_version）に委ね、
// 権限・状態の遷移・競合の検証は RPC が 1 トランザクションで行う。
//
// ⚠️ サーバ専用: service_role の管理クライアント（createAdminClient）を使うため、Route Handler からのみ import すること。
// 認証・組織の確定は呼び出し元（Route Handler）が getCurrentProfile() で行う。

import { createAdminClient } from '@/lib/supabase/admin';
import type { SsbjReportStatus, SsbjReportStatusAction } from '../types';

/**
 * RPC が使うカスタム SQLSTATE（正本は supabase/migrations/20261002090100_ssbj_report_status.sql・
 * 20261010100000_ssbj_self_approval_guard.sql と 20261002090200_ssbj_restore_version.sql — 変更時は両方を揃えること）。
 */
export const SSBJ_WORKFLOW_SQLSTATE = {
  /** レポート・版が無い、組織不一致、操作者が組織に属さない */
  reportInvalid: 'P2031',
  /** 画面が持っていた draftRevision が現在の値と一致しない */
  draftRevisionConflict: 'P2033',
  /** 承認済みのレポートは変更できない */
  locked: 'P2051',
  /** 承認者の指定が不正 */
  approverInvalid: 'P2052',
  /** その操作の権限が無い */
  forbidden: 'P2053',
  /** その状態からはできない操作 */
  invalidTransition: 'P2054',
  /** 版の形式が不正、または復元できない項目を含む */
  versionUnrestorable: 'P2055',
  /** 自己承認（承認者に自分を指定・レビューを依頼した本人の承認・依頼の後に内容を変更した人の承認） */
  selfApproval: 'P2056',
  /** 差戻しの理由が無い */
  reopenReasonRequired: 'P2057',
} as const;

/** RPC の DB エラー（SQLSTATE は SSBJ_WORKFLOW_SQLSTATE で判定する）。 */
export class SsbjWorkflowRpcError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = 'SsbjWorkflowRpcError';
    this.code = code;
  }
}

export interface ChangeSsbjReportStatusParams {
  reportId: string;
  organizationId: string;
  actorUserId: string;
  action: SsbjReportStatusAction;
  expectedDraftRevision: number;
  approverUserId?: string | null;
  comment?: string | null;
}

export interface ChangeSsbjReportStatusResult {
  status: SsbjReportStatus;
  approverUserId: string | null;
  reviewRequestedByUserId: string | null;
  approvedVersionId: string | null;
  approvedVersionNumber: number | null;
}

export const changeSsbjReportStatus = async (
  params: ChangeSsbjReportStatusParams,
): Promise<ChangeSsbjReportStatusResult> => {
  const { data, error } = await createAdminClient().rpc('change_ssbj_report_status', {
    p_report_id: params.reportId,
    p_organization_id: params.organizationId,
    p_actor_user_id: params.actorUserId,
    p_action: params.action,
    p_expected_draft_revision: params.expectedDraftRevision,
    p_approver_user_id: params.approverUserId ?? null,
    p_comment: params.comment ?? null,
  });
  if (error) throw new SsbjWorkflowRpcError(error.message, error.code);

  const result = data as Partial<ChangeSsbjReportStatusResult> | null;
  if (!result || typeof result.status !== 'string') {
    throw new Error('状態の変更結果が不正です');
  }
  return {
    status: result.status,
    approverUserId: result.approverUserId ?? null,
    reviewRequestedByUserId: result.reviewRequestedByUserId ?? null,
    approvedVersionId: result.approvedVersionId ?? null,
    approvedVersionNumber: result.approvedVersionNumber ?? null,
  };
};

export interface RestoreSsbjReportVersionParams {
  reportId: string;
  organizationId: string;
  actorUserId: string;
  versionId: string;
  expectedDraftRevision: number;
}

export interface RestoreSsbjReportVersionResult {
  restoredVersionNumber: number;
  backupVersionId: string;
  backupVersionNumber: number;
  draftRevision: number;
}

export const restoreSsbjReportVersion = async (
  params: RestoreSsbjReportVersionParams,
): Promise<RestoreSsbjReportVersionResult> => {
  const { data, error } = await createAdminClient().rpc('restore_ssbj_report_version', {
    p_report_id: params.reportId,
    p_organization_id: params.organizationId,
    p_actor_user_id: params.actorUserId,
    p_version_id: params.versionId,
    p_expected_draft_revision: params.expectedDraftRevision,
  });
  if (error) throw new SsbjWorkflowRpcError(error.message, error.code);

  const result = data as Partial<RestoreSsbjReportVersionResult> | null;
  if (
    !result || typeof result.restoredVersionNumber !== 'number' || typeof result.backupVersionId !== 'string' ||
    typeof result.backupVersionNumber !== 'number' || typeof result.draftRevision !== 'number'
  ) {
    throw new Error('復元の結果が不正です');
  }
  return result as RestoreSsbjReportVersionResult;
};
