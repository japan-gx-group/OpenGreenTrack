// 証跡一式（R2-33）の取得と、Excel のシートの組み立て。ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。
// 明細は DB 関数 ssbj_audit_trail_details（security invoker。自組織の年度だけ）から読む。閲覧者は呼ばない（画面に出さない。
// 出力の記録 record_ssbj_export も閲覧者の trail_xlsx を拒否する）。

import { createClient } from '@/lib/supabase/client';
import { timestampForFileName } from '@/lib/files/download';
import type { SsbjAuditLog, SsbjAuditTrailDetails } from '../types';
import {
  reconcileTrail,
  toSsbjAuditTrailDetails,
  trailAuditRows,
  trailDetailRows,
  trailEvidenceRows,
  trailFactorRows,
  trailSummaryRows,
  type TrailExportContext,
} from '../utils/auditTrail';
import type { SsbjXlsxSheet } from './versionXlsx';

/** レポートの年度の算定明細・係数・明細から計算し直した合計。 */
export const getSsbjAuditTrailDetails = async (fiscalYearId: string): Promise<SsbjAuditTrailDetails> => {
  const { data, error } = await createClient().rpc('ssbj_audit_trail_details', { p_fiscal_year_id: fiscalYearId });
  if (error) throw new Error('証跡の明細の取得に失敗しました');
  return toSsbjAuditTrailDetails(data);
};

/** 証跡一式のシート（サマリ・明細・係数・根拠・操作履歴）。 */
export const buildSsbjAuditTrailSheets = (
  context: TrailExportContext,
  trail: SsbjAuditTrailDetails,
  logs: readonly SsbjAuditLog[],
  nameOf: (userId: string | null) => string,
): SsbjXlsxSheet[] => {
  const { snapshot } = context.version;
  const summary = trailSummaryRows(context, reconcileTrail(snapshot.sections.ghg, trail));
  const details = trailDetailRows(trail, context.internalRecords);
  const evidence = trailEvidenceRows(snapshot, trail, context.internalRecords);
  const audit = trailAuditRows(logs, nameOf, snapshot.report.title, context.generatedAt);
  return [
    { name: 'サマリ', rows: summary.rows, headerRowIndex: summary.headerRowIndex, columnWidths: [34, 26, 22, 26, 10, 22, 12], wrapColumns: [0] },
    {
      name: '明細', rows: details, headerRowIndex: 0,
      columnWidths: [26, 20, 38, 18, 12, 14, 12, 12, 14, 10, 36, 14, 18, 38, 16, 16, 16, 30, 30, 26, ...(context.internalRecords ? [40] : [])],
      wrapColumns: [10, 18],
    },
    { name: '係数', rows: trailFactorRows(trail), headerRowIndex: 0, columnWidths: [38, 36, 10, 14, 14, 18, 10, 12, 16, 30, 30, 20, 20, 12, 12, 10, 14, 14, 10], wrapColumns: [1, 9] },
    { name: '根拠', rows: evidence.rows, headerRowIndex: evidence.headerRowIndexes[0] ?? null, columnWidths: [38, 30, 40, 30, 10, 24, 16, 16, 24, 66, 20, 16, 26], wrapColumns: [1, 2, 4] },
    { name: '操作履歴', rows: audit, headerRowIndex: audit.findIndex(row => row[0] === '日時'), columnWidths: [26, 18, 16, 44, 60, 40], wrapColumns: [3, 4] },
  ];
};

export const ssbjAuditTrailFileName = (versionNumber: number, generatedAt: string): string =>
  `SSBJ_証跡一式_版${versionNumber}_${timestampForFileName(generatedAt)}.xlsx`;
