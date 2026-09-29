// SSBJ レポートの作業中の内容を、保存版と同じ形で組み立てる Server 側処理（T12 のプレビュー。docs/ssbj-spec.md §8）。
// 組み立ては service_role 限定の RPC preview_ssbj_report（保存版の作成と同じ ssbj_build_report_snapshot）に委ねる。
// 作業中データの各テーブルを画面から個別に読んで組み立てると、保存版の形と食い違いうるため。
//
// ⚠️ サーバ専用: service_role の管理クライアント（createAdminClient）を使うため、Route Handler からのみ import すること。
// 認証・組織の確定は呼び出し元（Route Handler）が getCurrentProfile() で行う。

import { createAdminClient } from '@/lib/supabase/admin';
import type { SsbjReportSnapshotV1 } from '../types';
import { SSBJ_VERSION_SQLSTATE } from './versionServer';

export interface SsbjWorkingPreview {
  /** 組み立てた時点の ssbj_reports.draftRevision（作業中の内容の版数）。 */
  draftRevision: number;
  snapshot: SsbjReportSnapshotV1;
}

/** 作業中の内容を保存版と同じ形で返す。レポートが無い・組織が違う場合は null。 */
export const previewSsbjReport = async (params: {
  reportId: string;
  organizationId: string;
}): Promise<SsbjWorkingPreview | null> => {
  const { data, error } = await createAdminClient().rpc('preview_ssbj_report', {
    p_report_id: params.reportId,
    p_organization_id: params.organizationId,
  });
  if (error) {
    if (error.code === SSBJ_VERSION_SQLSTATE.reportInvalid) return null;
    throw new Error(`プレビューの組み立てに失敗しました: ${error.message}`);
  }
  const result = data as { draftRevision?: unknown; snapshot?: unknown } | null;
  if (!result || typeof result.draftRevision !== 'number' || !result.snapshot) {
    throw new Error('プレビューの組み立て結果が不正です');
  }
  return { draftRevision: result.draftRevision, snapshot: result.snapshot as SsbjReportSnapshotV1 };
};
