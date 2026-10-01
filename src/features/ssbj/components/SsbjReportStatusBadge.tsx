// SSBJ レポートの状態のバッジ（作成中 / レビュー中 / 承認済み。表示のみ）。

import { Badge } from '@/components/ui/badge';
import { SSBJ_REPORT_STATUS_LABELS, type SsbjReportStatus } from '../types';

const VARIANTS = { draft: 'neutral', in_review: 'info', approved: 'success' } as const;

export const SsbjReportStatusBadge = ({ status }: { status: SsbjReportStatus }) => (
  <Badge variant={VARIANTS[status]} data-testid="ssbj-report-status">{SSBJ_REPORT_STATUS_LABELS[status]}</Badge>
);
