// 承認済みのレポートの入力画面に出す案内（表示のみ）。承認済みの間は DB が変更を止めるため、編集の操作は出さない。

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { formatDateTime } from '@/lib/datetime';
import type { SsbjReportWorkingRecord } from '../types';
import { isSsbjReportLocked } from '../utils/reportStatus';

export const SsbjLockedNotice = ({ report }: { report: Pick<SsbjReportWorkingRecord, 'id' | 'review'> }) => {
  if (!isSsbjReportLocked(report.review)) return null;
  return (
    <div role="status" data-testid="ssbj-locked-notice"
      className="flex items-start gap-2 rounded-md bg-success-soft px-4 py-3 text-sm text-success">
      <Lock aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <p className="m-0">
        このレポートは承認済みのため編集できません
        {report.review.approvedAt && `（承認日時 ${formatDateTime(report.review.approvedAt)}）`}。
        変更するには、
        <Link href={`/ssbj/${encodeURIComponent(report.id)}`} className="font-semibold underline">レポート詳細</Link>
        で承認者か管理者が差戻してください。
      </p>
    </div>
  );
};
