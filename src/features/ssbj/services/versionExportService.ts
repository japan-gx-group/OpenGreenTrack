// 固定版と出力履歴（CSV / Excel）を組織別 RLS のもとで読み書きするブラウザ側サービス。
// 出力履歴は OGT 本体の system_audit_logs に書く（これまでの CSV 生成履歴と同じ場所）。SSBJ の操作履歴
// （ssbj_audit_logs）への記録は auditLogService.recordSsbjExport が別に行う。

import { createClient } from '@/lib/supabase/client';
import type { SsbjCsvVersion } from './versionCsv';

// 出力形式ごとの system_audit_logs.action。CSV はこれまでの値のまま（既存の履歴を読み続けるため）。
const AUDIT_ACTIONS = { csv: 'ssbj.csv.generate', xlsx: 'ssbj.xlsx.generate' } as const;
const AUDIT_ENTITY = 'ssbj_reports';

export type SsbjVersionExportFormat = keyof typeof AUDIT_ACTIONS;

const formatOfAction = (action: string): SsbjVersionExportFormat | null =>
  (Object.keys(AUDIT_ACTIONS) as SsbjVersionExportFormat[]).find(format => AUDIT_ACTIONS[format] === action) ?? null;

export type SsbjVersionSummary = {
  id: string;
  versionNumber: number;
  createdAt: string;
  note: string | null;
  sourceVersionId: string | null;
  createdByUserId: string | null;
  creatorName: string;
};

export type SsbjCsvHistory = {
  id: string;
  versionId: string;
  versionNumber: number;
  format: SsbjVersionExportFormat;
  createdAt: string;
};

export const listSsbjVersions = async (reportId: string): Promise<SsbjVersionSummary[]> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_report_versions')
    .select('id, versionNumber, createdAt, note, sourceVersionId, createdByUserId')
    .eq('reportId', reportId)
    .order('versionNumber', { ascending: false });
  if (error) throw new Error('保存履歴の取得に失敗しました');
  const rows = (data ?? []) as Omit<SsbjVersionSummary, 'creatorName'>[];
  const userIds = [...new Set(rows.flatMap(row => row.createdByUserId ? [row.createdByUserId] : []))];
  if (userIds.length === 0) return rows.map(row => ({ ...row, creatorName: '不明' }));
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, fullName, email')
    .in('id', userIds);
  if (profileError) return rows.map(row => ({ ...row, creatorName: '不明' }));
  const names = new Map((profiles ?? []).map(profile => [profile.id, profile.fullName || profile.email]));
  return rows.map(row => ({
    ...row,
    creatorName: row.createdByUserId ? names.get(row.createdByUserId) ?? '不明' : '不明',
  }));
};

export const getSsbjCsvVersion = async (reportId: string, versionId: string): Promise<SsbjCsvVersion> => {
  const { data, error } = await createClient()
    .from('ssbj_report_versions')
    .select('id, reportId, versionNumber, snapshot')
    .eq('reportId', reportId)
    .eq('id', versionId)
    .maybeSingle();
  if (error || !data) throw new Error('保存版が見つかりません');
  return data as SsbjCsvVersion;
};

export const listSsbjCsvHistory = async (reportId: string): Promise<SsbjCsvHistory[]> => {
  const { data, error } = await createClient()
    .from('system_audit_logs')
    .select('id, action, detail, createdAt')
    .in('action', Object.values(AUDIT_ACTIONS))
    .eq('entityName', AUDIT_ENTITY)
    .eq('entityId', reportId)
    .order('createdAt', { ascending: false })
    .limit(20);
  if (error) throw new Error('出力履歴の取得に失敗しました');
  return (data ?? []).flatMap(row => {
    try {
      const detail: unknown = JSON.parse(row.detail ?? 'null');
      if (
        typeof detail !== 'object' || detail === null ||
        !('versionId' in detail) || typeof detail.versionId !== 'string' ||
        !('versionNumber' in detail) || typeof detail.versionNumber !== 'number'
      ) return [];
      const format = formatOfAction(row.action);
      if (!format) return [];
      return [{ id: row.id, versionId: detail.versionId, versionNumber: detail.versionNumber, format, createdAt: row.createdAt }];
    } catch {
      return [];
    }
  });
};

/** 履歴の保存に失敗したときは例外にし、呼び出し元がダウンロードを中止できるようにする。 */
export const recordSsbjCsvGeneration = async (
  version: SsbjCsvVersion,
  format: SsbjVersionExportFormat = 'csv',
): Promise<SsbjCsvHistory> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('system_audit_logs')
    .insert({
      organizationId: version.snapshot.report.organizationId,
      action: AUDIT_ACTIONS[format],
      entityName: AUDIT_ENTITY,
      entityId: version.reportId,
      detail: JSON.stringify({ versionId: version.id, versionNumber: version.versionNumber }),
    })
    .select('id, createdAt')
    .single();
  if (error || !data) throw new Error('出力履歴を保存できなかったため、出力を中止しました');
  return { id: data.id, versionId: version.id, versionNumber: version.versionNumber, format, createdAt: data.createdAt };
};
