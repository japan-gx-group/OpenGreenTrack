// SSBJ レポートの一覧表（表示のみ）。状態を添え、行のレポート名から詳細画面へ遷移する。

import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/datetime';
import type { SsbjReportWorkingRecord } from '../types';
import { SsbjReportStatusBadge } from './SsbjReportStatusBadge';

export const SsbjReportTable = ({ reports }: { reports: SsbjReportWorkingRecord[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>レポート名</TableHead>
        <TableHead>状態</TableHead>
        <TableHead>対象年度</TableHead>
        <TableHead>報告範囲</TableHead>
        <TableHead>最終更新</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {reports.map(report => (
        <TableRow key={report.id}>
          <TableCell className="font-semibold">
            <Link href={`/ssbj/${report.id}`} className="text-primary hover:underline">
              {report.title}
            </Link>
          </TableCell>
          <TableCell><SsbjReportStatusBadge status={report.review.status} /></TableCell>
          <TableCell>{report.fiscalYearLabel}</TableCell>
          {/* 任意項目の未入力は「未入力」と出す（空欄・「なし」にしない） */}
          <TableCell className="text-text-muted">{report.reportingScope ?? '未入力'}</TableCell>
          <TableCell className="text-text-muted">{formatDateTime(report.updatedAt)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
