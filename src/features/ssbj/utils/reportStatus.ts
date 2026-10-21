// SSBJ レポートの状態管理と承認ロック（docs/ssbj-spec.md §13）の純関数: ロックの判定と、画面に出す操作の選び方。
// 権限と状態の遷移の正本は DB の RPC（change_ssbj_report_status）で、ここは画面の案内のための写し。
// 画面がボタンを出し間違えても、サーバが拒否する（その場合はサーバのメッセージを出す）。

import type { MemberRole } from '@/types/role';
import type { SsbjApprovalBlocker, SsbjReportReview, SsbjReportStatusAction } from '../types';

/** 承認済みで、作業中データを変更できないか。 */
export const isSsbjReportLocked = (review: Pick<SsbjReportReview, 'status'>): boolean => review.status === 'approved';

export const SSBJ_STATUS_ACTION_LABELS: Record<SsbjReportStatusAction, string> = {
  submit: 'レビューを依頼する',
  withdraw: '依頼を取り下げる',
  approve: '承認する',
  reopen: '差戻す',
};

/** 承認できない理由（自己承認）の案内。DB の change_ssbj_report_status が拒否するときのメッセージと同じ趣旨。 */
export const SSBJ_APPROVAL_BLOCKER_REASONS: Record<SsbjApprovalBlocker, string> = {
  requester: 'レビューを依頼した本人は承認できません。ほかの承認者か管理者が承認します',
  edited_after_request: 'レビューの依頼の後に内容を変更したため、承認できません。ほかの承認者か管理者が承認します',
};

export type SsbjStatusActionOption = {
  action: SsbjReportStatusAction;
  /** 押せるか。押せないときは reason を出す。 */
  allowed: boolean;
  reason: string | null;
};

/**
 * 今の状態で出す操作。承認・差戻しは、指定された承認者か OGT の管理者（profiles.role = 'admin'）だけが押せる。
 * OGT 本体はロールで権限を分けていないが、承認ロックの解除だけは要件として「管理者か承認者」に限る（DB も同じ判定）。
 * 承認は、さらに自己承認でないこと（レビューを依頼した本人でも、依頼の後に内容を変更した人でもないこと）が要る。
 * approvalBlocker はサーバ（ssbj_my_approval_blocker）に問い合わせた結果で、まだ分からないときは null を渡す。
 * 依頼した本人かどうかは、問い合わせの結果を待たずにレポートの記録からも判定する。
 */
export const ssbjStatusActions = (
  review: SsbjReportReview,
  currentUserId: string | null,
  currentRole: MemberRole | null,
  approvalBlocker: SsbjApprovalBlocker | null = null,
): SsbjStatusActionOption[] => {
  const privileged = currentRole === 'admin' || (currentUserId !== null && currentUserId === review.approverUserId);
  const restricted = (action: SsbjReportStatusAction): SsbjStatusActionOption => ({
    action,
    allowed: privileged,
    reason: privileged ? null : '指定された承認者か、管理者だけが操作できます',
  });
  const approve = (): SsbjStatusActionOption => {
    if (!privileged) return restricted('approve');
    const blocker: SsbjApprovalBlocker | null =
      currentUserId !== null && currentUserId === review.reviewRequestedByUserId ? 'requester' : approvalBlocker;
    return blocker === null
      ? { action: 'approve', allowed: true, reason: null }
      : { action: 'approve', allowed: false, reason: SSBJ_APPROVAL_BLOCKER_REASONS[blocker] };
  };
  switch (review.status) {
    case 'draft':
      return [{ action: 'submit', allowed: true, reason: null }];
    case 'in_review':
      return [approve(), restricted('reopen'), { action: 'withdraw', allowed: true, reason: null }];
    case 'approved':
      return [restricted('reopen')];
  }
};
