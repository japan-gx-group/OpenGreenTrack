// 固定版と CSV 生成履歴を組織別 RLS のもとで読み書きするブラウザ側サービス。

import { createClient } from '@/lib/supabase/client';
import type { SsbjCsvVersion } from './versionCsv';

const AUDIT_ACTION = 'ssbj.csv.generate';
const AUDIT_ENTITY = 'ssbj_reports';

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
    .select('id, detail, createdAt')
    .eq('action', AUDIT_ACTION)
    .eq('entityName', AUDIT_ENTITY)
    .eq('entityId', reportId)
    .order('createdAt', { ascending: false })
    .limit(20);
  if (error) throw new Error('CSV生成履歴の取得に失敗しました');
  return (data ?? []).flatMap(row => {
    try {
      const detail: unknown = JSON.parse(row.detail ?? 'null');
      if (
        typeof detail !== 'object' || detail === null ||
        !('versionId' in detail) || typeof detail.versionId !== 'string' ||
        !('versionNumber' in detail) || typeof detail.versionNumber !== 'number'
      ) return [];
      return [{ id: row.id, versionId: detail.versionId, versionNumber: detail.versionNumber, createdAt: row.createdAt }];
    } catch {
      return [];
    }
  });
};

/** 履歴の保存に失敗したときは例外にし、呼び出し元がダウンロードを中止できるようにする。 */
export const recordSsbjCsvGeneration = async (version: SsbjCsvVersion): Promise<SsbjCsvHistory> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('system_audit_logs')
    .insert({
      organizationId: version.snapshot.report.organizationId,
      action: AUDIT_ACTION,
      entityName: AUDIT_ENTITY,
      entityId: version.reportId,
      detail: JSON.stringify({ versionId: version.id, versionNumber: version.versionNumber }),
    })
    .select('id, createdAt')
    .single();
  if (error || !data) throw new Error('CSV生成履歴を保存できなかったため、出力を中止しました');
  return { id: data.id, versionId: version.id, versionNumber: version.versionNumber, createdAt: data.createdAt };
};
