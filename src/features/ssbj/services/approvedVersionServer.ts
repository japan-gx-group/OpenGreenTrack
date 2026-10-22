// 承認した保存版を、閲覧者にも返せる形（開示する内容だけ）で読む Server 側処理（docs/authorization-matrix.md §2.3）。
// 保存版は内部メモ・内部記録を含むため、閲覧者には RLS で行を見せない。ここで service_role で読み、
// 内部記録を除いてから返す（除き方は utils/disclosedSnapshot.ts）。
//
// ⚠️ サーバ専用: service_role の管理クライアント（createAdminClient）を使うため、Route Handler からのみ import すること。
// 認証・組織の確定・ロールの確認は呼び出し元（Route Handler）が getCurrentProfile() と guardSsbjRole で行う。

import { createAdminClient } from '@/lib/supabase/admin';
import type { SsbjReportSnapshotV1 } from '../types';
import { toSsbjDisclosedSnapshot } from '../utils/disclosedSnapshot';
import type { SsbjApprovedVersion } from './versionExportService';

export type SsbjApprovedVersionResult = {
  version: SsbjApprovedVersion;
  /** 分類に無かったため除いた項目（空でなければ分類の足し忘れ。呼び出し元がログに残す）。 */
  unclassifiedPaths: string[];
};

type SsbjVersionRow = {
  id: string;
  reportId: string;
  versionNumber: number;
  createdAt: string;
  note: string | null;
  createdByUserId: string | null;
  snapshot: SsbjReportSnapshotV1;
};

type AdminClient = ReturnType<typeof createAdminClient>;

/** 保存した人の表示名（保存履歴と同じく、氏名が無ければメール。分からなければ「不明」）。同じ組織の利用者だけを読む。 */
const creatorNameOf = async (supabase: AdminClient, userId: string | null, organizationId: string): Promise<string> => {
  if (!userId) return '不明';
  const { data, error } = await supabase
    .from('profiles')
    .select('fullName, email')
    .eq('id', userId)
    .eq('organizationId', organizationId)
    .maybeSingle();
  if (error || !data) return '不明';
  const profile = data as { fullName: string | null; email: string | null };
  return profile.fullName || profile.email || '不明';
};

/**
 * 自組織の承認済みのレポートの、承認した保存版を返す（内部メモ・内部記録を除く）。
 * レポートが無い・組織が違う・承認済みでない・承認した版が無いときは null（呼び出し元は区別せず 404 にする）。
 */
export const fetchSsbjApprovedVersion = async (params: {
  reportId: string;
  organizationId: string;
}): Promise<SsbjApprovedVersionResult | null> => {
  const supabase = createAdminClient();
  const { data: report, error: reportError } = await supabase
    .from('ssbj_reports')
    .select('status, approvedVersionId')
    .eq('id', params.reportId)
    .eq('organizationId', params.organizationId)
    .maybeSingle();
  if (reportError) throw new Error(`レポートの取得に失敗しました: ${reportError.message}`);
  const reportRow = report as { status: string; approvedVersionId: string | null } | null;
  if (!reportRow || reportRow.status !== 'approved' || !reportRow.approvedVersionId) return null;

  const { data: version, error: versionError } = await supabase
    .from('ssbj_report_versions')
    .select('id, reportId, versionNumber, createdAt, note, createdByUserId, snapshot')
    .eq('id', reportRow.approvedVersionId)
    .eq('reportId', params.reportId)
    .eq('organizationId', params.organizationId)
    .maybeSingle();
  if (versionError) throw new Error(`承認した保存版の取得に失敗しました: ${versionError.message}`);
  if (!version) return null;
  const row = version as SsbjVersionRow;

  const { snapshot, unclassifiedPaths } = toSsbjDisclosedSnapshot(row.snapshot);
  return {
    version: {
      id: row.id,
      reportId: row.reportId,
      versionNumber: row.versionNumber,
      createdAt: row.createdAt,
      note: row.note,
      // 閲覧者は他の版を見られないので、元の版は返さない（承認時の版は過去版から作らないため、もともと無い）。
      sourceVersionId: null,
      createdByUserId: row.createdByUserId,
      creatorName: await creatorNameOf(supabase, row.createdByUserId, params.organizationId),
      snapshot,
    },
    unclassifiedPaths,
  };
};
