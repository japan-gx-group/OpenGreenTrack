// SSBJ レポートの保存版（固定スナップショット）を作る Server 側処理（docs/ssbj-spec.md §8）。
// 採番・スナップショット生成・insert は service_role 限定 RPC create_ssbj_report_version
// （supabase/migrations/20260927180425_ssbj_report_versions.sql）に委ねる（単一トランザクション）。
//
// ⚠️ サーバ専用: service_role の管理クライアント（createAdminClient）を使うため、
// Route Handler からのみ import すること。認証・組織の検証は呼び出し元（Route Handler）が
// getCurrentProfile() で行った前提で、ここでは受け取った organizationId をそのまま RPC に渡す。

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * create_ssbj_report_version RPC が使うカスタム SQLSTATE（apiRateLimit.ts の HEAVY_API_SQLSTATE と
 * 同じ方式。正本は supabase/migrations/20260927180425_ssbj_report_versions.sql — 変更時は両方を揃えること）。
 */
export const SSBJ_VERSION_SQLSTATE = {
  /** 対象レポートが存在しない・組織不一致・復元元の版が見つからない */
  reportInvalid: 'P2031',
  /** 保存時に渡した draftRevision が現在の値と一致しない（他の変更との競合） */
  draftRevisionConflict: 'P2033',
} as const;

export interface CreateSsbjReportVersionParams {
  reportId: string;
  organizationId: string;
  actorUserId: string;
  /** 画面が読込時に保持していた ssbj_reports.draftRevision。 */
  expectedDraftRevision: number;
  note?: string | null;
  /** 過去版のスナップショットから新版を作るときだけ渡す。作業中データは変更しない。 */
  sourceVersionId?: string | null;
}

export interface CreateSsbjReportVersionResult {
  id: string;
  versionNumber: number;
}

/** RPC の DB エラーをそのまま呼び出し元へ投げる（SQLSTATE は SSBJ_VERSION_SQLSTATE で判定する）。 */
export class SsbjReportVersionRpcError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = 'SsbjReportVersionRpcError';
    this.code = code;
  }
}

export const createSsbjReportVersion = async (
  params: CreateSsbjReportVersionParams,
): Promise<CreateSsbjReportVersionResult> => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('create_ssbj_report_version', {
    p_report_id: params.reportId,
    p_organization_id: params.organizationId,
    p_actor_user_id: params.actorUserId,
    p_expected_draft_revision: params.expectedDraftRevision,
    p_note: params.note ?? null,
    p_source_version_id: params.sourceVersionId ?? null,
  });

  if (error) {
    throw new SsbjReportVersionRpcError(error.message, error.code);
  }

  const result = data as { id: string; versionNumber: number } | null;
  if (!result || typeof result.id !== 'string' || typeof result.versionNumber !== 'number') {
    throw new Error('保存版の作成結果が不正です');
  }
  return result;
};
