// SSBJ レポートの基本情報の表示（表示のみ）。任意項目の未入力は「未入力」と出し、空欄や「なし」にしない。

import { formatDateTime } from '@/lib/datetime';
import type { SsbjReportRecord } from '../types';

const UNANSWERED_LABEL = '未入力';

const Row = ({ label, value }: { label: string; value: string | null }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
    <dt className="w-40 shrink-0 text-xs font-semibold text-text-muted">{label}</dt>
    <dd className={value === null ? 'm-0 text-sm text-text-muted' : 'm-0 text-sm whitespace-pre-wrap'}>
      {value ?? UNANSWERED_LABEL}
    </dd>
  </div>
);

export const SsbjReportBasicInfo = ({ report }: { report: SsbjReportRecord }) => (
  <dl className="m-0 flex flex-col gap-3">
    <Row label="レポート名" value={report.title} />
    <Row label="対象年度" value={`${report.fiscalYearLabel}（${report.periodStart} 〜 ${report.periodEnd}）`} />
    <Row label="作成目的" value={report.purpose} />
    <Row label="報告範囲" value={report.reportingScope} />
    <Row label="参照する基準の版" value={report.standardVersion} />
    <Row label="作成日時" value={formatDateTime(report.createdAt)} />
    <Row label="最終更新" value={formatDateTime(report.updatedAt)} />
  </dl>
);
