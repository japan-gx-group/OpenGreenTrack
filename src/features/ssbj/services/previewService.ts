// SSBJ レポートのプレビュー（T12）で表示する内容を取得するブラウザ側のサービス。
// 作業中の内容は Route Handler（保存版と同じ組み立て）から、保存版は ssbj_report_versions から RLS のもとで読む。
// どちらも SsbjReportSnapshotV1 の形なので、画面は同じ部品で描ける。

import { createClient } from '@/lib/supabase/client';
import type { SsbjReportSnapshotV1 } from '../types';

/** プレビューに出す内容。作業中か保存版かを必ず区別して持つ（画面で取り違えないため）。 */
export type SsbjPreviewSource =
  | { kind: 'working'; draftRevision: number; snapshot: SsbjReportSnapshotV1 }
  | { kind: 'version'; versionId: string; versionNumber: number; createdAt: string; snapshot: SsbjReportSnapshotV1 };

/** 作業中の内容（保存していない変更を含む）を、保存版と同じ形で取得する。 */
export const getSsbjWorkingPreview = async (reportId: string): Promise<SsbjPreviewSource> => {
  const response = await fetch(`/api/ssbj/reports/${encodeURIComponent(reportId)}/preview`);
  const body = (await response.json().catch(() => null)) as
    | { draftRevision?: number; snapshot?: SsbjReportSnapshotV1; error?: string }
    | null;
  if (!response.ok || typeof body?.draftRevision !== 'number' || !body.snapshot) {
    throw new Error(body?.error ?? 'プレビューの取得に失敗しました');
  }
  return { kind: 'working', draftRevision: body.draftRevision, snapshot: body.snapshot };
};

/** 保存版 1 件。作成後に書き換えられないため、表示中に内容が変わることはない。 */
export const getSsbjVersionPreview = async (reportId: string, versionId: string): Promise<SsbjPreviewSource> => {
  const { data, error } = await createClient()
    .from('ssbj_report_versions')
    .select('id, versionNumber, createdAt, snapshot')
    .eq('reportId', reportId)
    .eq('id', versionId)
    .maybeSingle();
  if (error || !data) throw new Error('保存版が見つかりません');
  const row = data as { id: string; versionNumber: number; createdAt: string; snapshot: SsbjReportSnapshotV1 };
  return {
    kind: 'version',
    versionId: row.id,
    versionNumber: row.versionNumber,
    createdAt: row.createdAt,
    snapshot: row.snapshot,
  };
};
