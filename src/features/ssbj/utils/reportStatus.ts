// SSBJ レポートの状態管理と承認ロック（docs/ssbj-spec.md §13）の純関数: ロックの判定と、画面に出す操作の選び方。
// 権限と状態の遷移の正本は DB の RPC（change_ssbj_report_status）で、ここは画面の案内のための写し。
// 画面がボタンを出し間違えても、サーバが拒否する（その場合はサーバのメッセージを出す）。

import type { MemberRole } from '@/types/role';
import type { SsbjReportReview, SsbjReportStatusAction } from '../types';

/** 承認済みで、作業中データを変更できないか。 */
export const isSsbjReportLocked = (review: Pick<SsbjReportReview, 'status'>): boolean => review.status === 'approved';

export const SSBJ_STATUS_ACTION_LABELS: Record<SsbjReportStatusAction, string> = {
  submit: 'レビューを依頼する',
  withdraw: '依頼を取り下げる',
  approve: '承認する',
  reopen: '差戻す',
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
 */
export const ssbjStatusActions = (
  review: SsbjReportReview,
  currentUserId: string | null,
  currentRole: MemberRole | null,
): SsbjStatusActionOption[] => {
  const privileged = currentRole === 'admin' || (currentUserId !== null && currentUserId === review.approverUserId);
  const restricted = (action: SsbjReportStatusAction): SsbjStatusActionOption => ({
    action,
    allowed: privileged,
    reason: privileged ? null : '指定された承認者か、管理者だけが操作できます',
  });
  switch (review.status) {
    case 'draft':
      return [{ action: 'submit', allowed: true, reason: null }];
    case 'in_review':
      return [restricted('approve'), restricted('reopen'), { action: 'withdraw', allowed: true, reason: null }];
    case 'approved':
      return [restricted('reopen')];
  }
};
