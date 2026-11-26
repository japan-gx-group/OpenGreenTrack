'use client';

// 差し戻されたレポートの、画面の上に出す帯（docs/ssbj-spec.md §13「差戻しの理由を画面の上に出す」）。
// 最新の差戻しの理由・誰が・いつを出し、次にすること（直して、もう一度依頼する）と操作履歴への入口を添える。
// 差戻した人の名前は、組織の利用者の一覧（useSsbjReportMembers。Provider の中では Provider が読んだもの）から引く。帯を出すときだけ読む。

import Link from 'next/link';
import { Undo2 } from 'lucide-react';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjReportMembers } from '../hooks/useSsbjReportOverview';
import { memberName } from '../services/memberService';
import type { SsbjReopenNotice as SsbjReopenNoticeValue } from '../utils/auditLog';

interface SsbjReopenNoticeProps {
  reportId: string;
  notice: SsbjReopenNoticeValue;
  /**
   * 今いる画面（詳細画面は ''）。詳細画面では「状態と承認」が同じ画面にあるので詳細へのリンクを、
   * 操作履歴の画面では「操作履歴で見る」を出さない。
   */
  current: string;
}

export const SsbjReopenNotice = ({ reportId, notice, current }: SsbjReopenNoticeProps) => {
  const { members, isLoading } = useSsbjReportMembers();
  const onDetail = current === '';
  const base = `/ssbj/${encodeURIComponent(reportId)}`;
  const who = isLoading ? null : memberName(members, notice.actorUserId);
  return (
    <div role="status" data-testid="ssbj-reopen-notice"
      className="flex items-start gap-2 rounded-md border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
      <Undo2 aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 font-bold">
          差し戻されました（{who ? `${who}・` : ''}{formatDateTime(notice.reopenedAt)}）
        </p>
        {notice.comment && <p className="m-0 whitespace-pre-wrap break-words text-foreground">{notice.comment}</p>}
        <p className="m-0">
          直したら、
          {onDetail ? '「状態と承認」から' : (
            <><Link href={base} className="font-semibold underline">レポート詳細</Link>の「状態と承認」から</>
          )}
          もう一度レビューを依頼してください。
          {current !== 'history' && (
            <>
              {' '}・{' '}
              <Link href={`${base}/history`} className="font-semibold underline">操作履歴で見る</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
};
