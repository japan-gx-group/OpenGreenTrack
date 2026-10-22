// SSBJ レポートの基本情報の表示（表示のみ）。任意項目の未入力は「未入力」と出し、空欄や「なし」にしない。
// 業種は、該当する産業別ガイダンスの巻へのリンクを添える（本文は転記しない。docs/ssbj-r1-scope.md §6）。
// 保存版の report は保存した時点の形のまま表示する。親会社名・持分比率・業種などの任意項目を追加する前に
// 保存した版にはそのキーが無い（undefined）ため、未入力の判定は null と undefined の両方を拾う（== null）。

import { ExternalLink } from 'lucide-react';
import { formatDateTime } from '@/lib/datetime';
import {
  SSBJ_MEASUREMENT_APPROACH_LABELS,
  SSBJ_PARENT_RELATIONSHIP_LABELS,
  type SsbjReportRecord,
} from '../types';
import { findSicsIndustry, formatSicsIndustry, sicsGuidanceUrl } from '../utils/sicsIndustries';

const UNANSWERED_LABEL = '未入力';

const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
    <dt className="w-40 shrink-0 text-xs font-semibold text-text-muted">{label}</dt>
    <dd className={value == null ? 'm-0 text-sm text-text-muted' : 'm-0 text-sm whitespace-pre-wrap'}>
      {value ?? UNANSWERED_LABEL}
    </dd>
  </div>
);

const IndustryRow = ({ code }: { code: string | null | undefined }) => {
  const industry = code ? findSicsIndustry(code) : undefined;
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-semibold text-text-muted">業種（SICS）</dt>
      {code == null ? (
        <dd className="m-0 text-sm text-text-muted">{UNANSWERED_LABEL}</dd>
      ) : (
        <dd className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {formatSicsIndustry(code)}
          {industry && (
            <a
              href={sicsGuidanceUrl(industry)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              産業別ガイダンス（第{industry.volume}巻）
              <ExternalLink aria-hidden="true" size={12} />
            </a>
          )}
        </dd>
      )}
    </div>
  );
};

export const SsbjReportBasicInfo = ({ report }: { report: SsbjReportRecord }) => (
  <dl className="m-0 flex flex-col gap-3">
    <Row label="レポート名" value={report.title} />
    <Row label="対象年度" value={`${report.fiscalYearLabel}（${report.periodStart} 〜 ${report.periodEnd}）`} />
    <Row label="作成目的" value={report.purpose} />
    <Row label="報告範囲" value={report.reportingScope} />
    <Row label="参照する基準の版" value={report.standardVersion} />
    <Row label="親会社名" value={report.parentCompanyName} />
    <Row
      label="親会社との関係"
      value={report.parentRelationship ? SSBJ_PARENT_RELATIONSHIP_LABELS[report.parentRelationship] : null}
    />
    <Row
      label="親会社の持分比率"
      value={report.ownershipPercentage == null ? null : `${report.ownershipPercentage}%`}
    />
    <Row
      label="測定アプローチ"
      value={report.measurementApproach ? SSBJ_MEASUREMENT_APPROACH_LABELS[report.measurementApproach] : null}
    />
    <IndustryRow code={report.industryCode} />
    <Row label="作成日時" value={formatDateTime(report.createdAt)} />
    <Row label="最終更新" value={formatDateTime(report.updatedAt)} />
  </dl>
);
