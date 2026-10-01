// SSBJ レポートの操作履歴（ssbj_audit_logs）の取得と、ファイル出力の記録（docs/ssbj-spec.md §13「操作履歴」）。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。自組織の履歴だけが見える（RLS）。
// 履歴は DB のトリガーと RPC が書く。画面から書けるのはファイル出力の記録（record_ssbj_export）だけ。

import { createClient } from '@/lib/supabase/client';
import { SSBJ_AUDIT_ACTIONS, type SsbjAuditAction, type SsbjAuditLog, type SsbjExportFormat } from '../types';

/** 画面に読み込む件数の上限（新しい順）。出力もこの範囲で行う。 */
export const SSBJ_AUDIT_LOG_LIMIT = 1000;

const SELECT_COLUMNS = 'id, reportId, actorUserId, action, targetType, targetId, changedColumns, details, createdAt';

type SsbjAuditLogRow = {
  id: number;
  reportId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  changedColumns: string[] | null;
  details: unknown;
  createdAt: string;
};

/** DB 行 → 操作履歴。操作の種類が不明な行は例外にする（DB の check 制約と食い違っている）。 */
export const toSsbjAuditLog = (row: SsbjAuditLogRow): SsbjAuditLog => {
  if (!(SSBJ_AUDIT_ACTIONS as readonly string[]).includes(row.action)) {
    throw new Error(`操作履歴の操作が不正です: ${row.action}`);
  }
  return {
    id: row.id,
    reportId: row.reportId,
    actorUserId: row.actorUserId,
    action: row.action as SsbjAuditAction,
    targetType: row.targetType,
    targetId: row.targetId,
    changedColumns: row.changedColumns,
    details: typeof row.details === 'object' && row.details !== null ? (row.details as Record<string, unknown>) : {},
    createdAt: row.createdAt,
  };
};

/** レポートの操作履歴（新しい順、最大 SSBJ_AUDIT_LOG_LIMIT 件）。 */
export const listSsbjAuditLogs = async (reportId: string): Promise<SsbjAuditLog[]> => {
  const { data, error } = await createClient()
    .from('ssbj_audit_logs')
    .select(SELECT_COLUMNS)
    .eq('reportId', reportId)
    .order('id', { ascending: false })
    .limit(SSBJ_AUDIT_LOG_LIMIT);
  if (error) throw new Error('操作履歴の取得に失敗しました');
  return ((data ?? []) as SsbjAuditLogRow[]).map(toSsbjAuditLog);
};

/**
 * ファイルの出力を操作履歴に記録する（出力の直前に呼ぶ）。記録できなければ例外にし、呼び出し元は出力を中止する
 * （誰がいつ出力したかを残せない出力をさせないため）。
 */
export const recordSsbjExport = async (
  reportId: string,
  format: SsbjExportFormat,
  versionId: string | null = null,
): Promise<void> => {
  const { error } = await createClient().rpc('record_ssbj_export', {
    p_report_id: reportId,
    p_format: format,
    p_version_id: versionId,
  });
  if (error) throw new Error('出力の記録を保存できなかったため、出力を中止しました');
};
