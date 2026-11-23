// ヘッダーのベルに出す、SSBJ レポートのレビューのお知らせ（依頼された・依頼が作成中に戻った・承認された）。
// 通知のテーブルは持たず、ssbj_reports の状態・承認者・依頼者・状態の変更日時と変更した人から組み立てる
// （見える範囲は ssbj_reports の RLS のまま）。既読はベル全体の仕組み（ブラウザの既読の基準時刻）に任せる。

import type { AppNotification } from '@/features/notifications/services/notificationService';

export type SsbjReviewNotificationRow = {
  id: string;
  title: string;
  status: string;
  approverUserId: string | null;
  reviewRequestedByUserId: string | null;
  statusChangedAt: string | null;
  statusChangedByUserId: string | null;
};

/** 作成中に戻った・承認されたお知らせを出す日数。依頼されたお知らせは、レビュー中のあいだ出し続ける（対応が要るため）。 */
export const SSBJ_REVIEW_NOTIFICATION_DAYS = 14;

/**
 * 1 件のレポートから、ログイン中の利用者（userId）へのお知らせを作る。当てはまらなければ null。
 * - レビュー中で、自分が承認者 → 「レビューを頼まれています」
 * - 自分が依頼したレポートが、ほかの人の操作で作成中に戻った → 「レビューの依頼が作成中に戻りました」
 *   （差戻しと、ほかの人による取り下げは ssbj_reports だけでは見分けられないため、両方をこの文で知らせる）
 * - 自分が依頼したレポートが承認された → 「承認されました」
 */
export const toSsbjReviewNotification = (
  row: SsbjReviewNotificationRow,
  userId: string,
  now: Date = new Date(),
): AppNotification | null => {
  if (!row.statusChangedAt) return null;
  const href = `/ssbj/${encodeURIComponent(row.id)}`;
  const base = { id: `ssbj-review:${row.id}:${row.status}:${row.statusChangedAt}`, occurredAt: row.statusChangedAt, href };

  if (row.status === 'in_review' && row.approverUserId === userId) {
    return {
      ...base,
      level: 'warning',
      title: 'SSBJ レポートのレビューを頼まれています',
      description: `「${row.title}」の承認者に指定されています。内容を確かめて、承認するか差し戻してください。`,
    };
  }

  const ageDays = (now.getTime() - new Date(row.statusChangedAt).getTime()) / 86_400_000;
  if (row.reviewRequestedByUserId !== userId || !(ageDays <= SSBJ_REVIEW_NOTIFICATION_DAYS)) return null;

  if (row.status === 'draft' && row.statusChangedByUserId !== null && row.statusChangedByUserId !== userId) {
    return {
      ...base,
      level: 'warning',
      title: 'SSBJ レポートのレビューの依頼が作成中に戻りました',
      description: `「${row.title}」が差戻しか取り下げで作成中に戻りました。理由は操作履歴で確かめられます。直したら、もう一度レビューを依頼してください。`,
    };
  }
  if (row.status === 'approved') {
    return {
      ...base,
      level: 'info',
      title: 'SSBJ レポートが承認されました',
      description: `「${row.title}」が承認されました。承認した保存版は保存履歴から出力できます。`,
    };
  }
  return null;
};
