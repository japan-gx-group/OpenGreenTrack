// レビューを依頼する前の点検表（表示のみ）。詳細画面の「状態と承認」で、依頼ボタンの上に出す。
// 行ごとに ✓／注意／要確認と件数を出し、該当の画面へ開けるようにする。依頼は止めず、知らせるだけにする
// （行の組み立ては utils/reviewChecklist.ts）。

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ssbjReportPath } from '../utils/reportContents';
import {
  isSsbjChecklistFlagged,
  SSBJ_CHECKLIST_STATUS_LABELS,
  type SsbjChecklistRow,
  type SsbjChecklistStatus,
} from '../utils/reviewChecklist';

const BADGE_VARIANTS: Record<SsbjChecklistStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  warning: 'warning',
  review: 'danger',
  checking: 'neutral',
};

interface SsbjReviewChecklistProps {
  reportId: string;
  /** 点検表の行（数えている間は null）。 */
  rows: SsbjChecklistRow[] | null;
  /** 作業中の内容を読めなかったとき（点検表を出せない）。 */
  errorMessage?: string;
}

export const SsbjReviewChecklist = ({ reportId, rows, errorMessage = '' }: SsbjReviewChecklistProps) => {
  if (!rows && errorMessage) {
    return (
      <p role="alert" className="m-0 text-sm text-danger" data-testid="ssbj-review-checklist">
        依頼の前の点検ができませんでした（{errorMessage}）。依頼はできます。
      </p>
    );
  }
  if (!rows) {
    return <p className="m-0 text-sm text-text-muted" data-testid="ssbj-review-checklist">依頼の前の点検をしています...</p>;
  }
  const flagged = rows.filter(isSsbjChecklistFlagged).length;
  return (
    <section aria-labelledby="ssbj-review-checklist-heading" data-testid="ssbj-review-checklist"
      className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3">
      <h3 id="ssbj-review-checklist-heading" className="m-0 text-sm font-semibold">
        依頼の前の点検（{rows.length} 項目中 {flagged === 0 ? 'すべて ✓' : `${flagged} 項目に注意`}）
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map(row => (
          <li key={row.key} data-testid={`ssbj-review-checklist-${row.key}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Badge variant={BADGE_VARIANTS[row.status]} className="min-w-12">
              {SSBJ_CHECKLIST_STATUS_LABELS[row.status]}
              {isSsbjChecklistFlagged(row) && row.count !== null && row.count > 0 && <span className="tabular-nums">{row.count}</span>}
            </Badge>
            <span className="font-semibold">{row.label}</span>
            <span className="min-w-0 flex-1 text-text-muted">{row.detail}</span>
            {isSsbjChecklistFlagged(row) && (
              <Link href={ssbjReportPath(reportId, row.path)}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline">
                開く<ChevronRight aria-hidden="true" size={14} />
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="m-0 text-xs text-text-muted">注意や要確認があっても、レビューは依頼できます（未確認のまま出すのが正しい場合もあるため）。</p>
    </section>
  );
};
