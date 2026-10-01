'use client';

// SSBJ レポートの操作履歴の画面（/ssbj/[reportId]/history。docs/ssbj-spec.md §13「操作履歴」）。
// 誰が・いつ・何をしたか（データの作成・更新・削除、状態の変更、保存版の作成・復元、ファイルの出力）を新しい順に出し、
// 操作の種類で絞り込み、CSV / Excel で出力する。出力も操作履歴に記録してから行う（記録できなければ出力しない）。

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FileCheck2, FileSpreadsheet } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { downloadCsv } from '@/lib/files/csv';
import { timestampForFileName } from '@/lib/files/download';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjAuditLogs } from '../hooks/useSsbjAuditLogs';
import { useSsbjMembers } from '../hooks/useSsbjMembers';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { SSBJ_AUDIT_LOG_LIMIT, recordSsbjExport } from '../services/auditLogService';
import { memberName } from '../services/memberService';
import { buildSsbjWorkbook, downloadSsbjWorkbook } from '../services/versionXlsx';
import { SSBJ_AUDIT_ACTIONS, type SsbjAuditAction } from '../types';
import {
  SSBJ_AUDIT_ACTION_LABELS,
  ssbjAuditDetail,
  ssbjAuditExportRows,
  ssbjAuditTargetLabel,
} from '../utils/auditLog';
import { SsbjTrialNotice } from './SsbjTrialNotice';

type ExportFormat = 'audit_csv' | 'audit_xlsx';

export const SsbjAuditLogs = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: reportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const { logs, isLoading: logsLoading, errorMessage: logsError, reload } = useSsbjAuditLogs(report?.id ?? null);
  // 「操作した人」を名前で出すため、利用者の一覧がそろってから表を出す（出力にも名前を使う）。
  const { members, isLoading: membersLoading, errorMessage: membersError } = useSsbjMembers();
  const [action, setAction] = useState<SsbjAuditAction | ''>('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const nameOf = (userId: string | null) => memberName(members, userId);
  const visible = action === '' ? logs : logs.filter(log => log.action === action);

  const exportLogs = async (format: ExportFormat) => {
    if (!report || isExporting) return;
    setIsExporting(true);
    setExportError('');
    try {
      const generatedAt = new Date().toISOString();
      const rows = ssbjAuditExportRows(visible, nameOf, report.title, generatedAt);
      await recordSsbjExport(report.id, format);
      const baseName = `SSBJ_操作履歴_${timestampForFileName(generatedAt)}`;
      if (format === 'audit_csv') {
        downloadCsv(`${baseName}.csv`, rows);
      } else {
        const headerRowIndex = rows.findIndex(row => row[0] === '日時');
        await downloadSsbjWorkbook(await buildSsbjWorkbook([{
          name: '操作履歴',
          rows,
          headerRowIndex,
          columnWidths: [26, 18, 16, 44, 60, 40],
          wrapColumns: [3, 4],
        }]), `${baseName}.xlsx`);
      }
      reload();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '操作履歴の出力に失敗しました');
    } finally {
      setIsExporting(false);
    }
  };

  const errorMessage = reportError || logsError || membersError || exportError;

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading title="操作履歴" description={report?.title ?? 'SSBJレポート'} showFiscalYear={false} primaryAction={null} />
      <div className="flex flex-col gap-4">
        <Link href={`/ssbj/${encodeURIComponent(reportId)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {errorMessage && <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">{errorMessage}</div>}
        {reportLoading || logsLoading || membersLoading ? (
          <Card><LoadingIndicator label="操作履歴を読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
          </Card>
        ) : report && !logsError ? (
          <Card>
            <p className="m-0 mb-3 text-sm text-text-muted">
              このレポートのデータの作成・更新・削除、状態の変更（レビュー依頼・承認・差戻し）、保存版の作成・復元、
              ファイルの出力を、誰がいつ行ったかを自動で記録しています。記録はあとから書き換えられません。
              新しい順に最大 {SSBJ_AUDIT_LOG_LIMIT} 件を表示します（印刷・PDF 保存は記録されません）。
            </p>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ssbj-audit-action">操作の種類</Label>
                <select
                  id="ssbj-audit-action"
                  className="gt-field gt-field-select"
                  value={action}
                  onChange={event => setAction(event.target.value as SsbjAuditAction | '')}
                >
                  <option value="">すべて</option>
                  {SSBJ_AUDIT_ACTIONS.map(item => <option key={item} value={item}>{SSBJ_AUDIT_ACTION_LABELS[item]}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={isExporting || visible.length === 0} onClick={() => void exportLogs('audit_csv')}>
                  <Download size={14} /> CSVで出力
                </Button>
                <Button type="button" variant="outline" disabled={isExporting || visible.length === 0} onClick={() => void exportLogs('audit_xlsx')}>
                  <FileSpreadsheet size={14} /> Excelで出力
                </Button>
              </div>
            </div>
            <p data-testid="ssbj-audit-count" className="m-0 mb-2 text-xs text-text-muted">{visible.length} 件</p>
            {visible.length === 0 ? (
              <p className="m-0 py-6 text-center text-sm text-text-muted">記録はまだありません。</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日時</TableHead>
                    <TableHead>操作した人</TableHead>
                    <TableHead>操作</TableHead>
                    <TableHead>対象</TableHead>
                    <TableHead>内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map(log => (
                    <TableRow key={log.id} data-testid="ssbj-audit-row">
                      <TableCell className="whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">{nameOf(log.actorUserId)}</TableCell>
                      <TableCell className="whitespace-nowrap">{SSBJ_AUDIT_ACTION_LABELS[log.action]}</TableCell>
                      <TableCell className="min-w-48 whitespace-normal">{ssbjAuditTargetLabel(log)}</TableCell>
                      <TableCell className="min-w-48 whitespace-normal text-text-muted">{ssbjAuditDetail(log, nameOf)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
};
