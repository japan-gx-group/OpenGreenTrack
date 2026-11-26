import { describe, expect, it } from 'vitest';
import { SSBJ_REVIEW_NOTIFICATION_DAYS, toSsbjReviewNotification, type SsbjReviewNotificationRow } from '../reviewNotification';

const ME = 'user-me';
const OTHER = 'user-other';
const NOW = new Date('2026-11-20T00:00:00.000Z');
const row = (overrides: Partial<SsbjReviewNotificationRow> = {}): SsbjReviewNotificationRow => ({
  id: 'report-1',
  title: '架空サンプル株式会社 2024年度',
  status: 'in_review',
  approverUserId: ME,
  reviewRequestedByUserId: OTHER,
  statusChangedAt: '2026-11-19T09:00:00.000Z',
  statusChangedByUserId: OTHER,
  ...overrides,
});

describe('toSsbjReviewNotification', () => {
  it('レビュー中で自分が承認者なら「レビューを頼まれています」を出し、詳細へ移れる', () => {
    const notification = toSsbjReviewNotification(row(), ME, NOW);
    expect(notification).toMatchObject({
      level: 'warning',
      title: 'SSBJ レポートのレビューを頼まれています',
      href: '/ssbj/report-1',
      occurredAt: '2026-11-19T09:00:00.000Z',
    });
    expect(notification?.description).toContain('「架空サンプル株式会社 2024年度」の承認者に指定されています');
  });

  it('依頼されたお知らせは、日がたってもレビュー中のあいだ出す', () => {
    expect(toSsbjReviewNotification(row({ statusChangedAt: '2026-09-01T00:00:00.000Z' }), ME, NOW)).not.toBeNull();
  });

  it('自分が依頼したレポートが、ほかの人の操作で作成中に戻ったら知らせる（自分で取り下げたときは出さない）', () => {
    const reopened = row({ status: 'draft', approverUserId: OTHER, reviewRequestedByUserId: ME, statusChangedByUserId: OTHER });
    expect(toSsbjReviewNotification(reopened, ME, NOW)?.title).toBe('SSBJ レポートのレビューの依頼が作成中に戻りました');
    // 承認後に管理者が作成中に戻した場合も同じ状態の変更なので、それも含むことが分かる文にする。
    expect(toSsbjReviewNotification(reopened, ME, NOW)?.description).toContain('承認後に管理者が作成中に戻した場合も含みます');
    expect(toSsbjReviewNotification({ ...reopened, statusChangedByUserId: ME }, ME, NOW)).toBeNull();
  });

  it('自分が依頼したレポートが承認されたら知らせる', () => {
    const approved = row({ status: 'approved', approverUserId: OTHER, reviewRequestedByUserId: ME });
    expect(toSsbjReviewNotification(approved, ME, NOW)).toMatchObject({ level: 'info', title: 'SSBJ レポートが承認されました' });
  });

  it(`作成中に戻った・承認されたお知らせは ${SSBJ_REVIEW_NOTIFICATION_DAYS} 日を過ぎたら出さない`, () => {
    const old = new Date(NOW.getTime() - (SSBJ_REVIEW_NOTIFICATION_DAYS + 1) * 86_400_000).toISOString();
    const approved = row({ status: 'approved', approverUserId: OTHER, reviewRequestedByUserId: ME, statusChangedAt: old });
    expect(toSsbjReviewNotification(approved, ME, NOW)).toBeNull();
  });

  it('自分に関係しない・状態の変更日時が無いレポートは出さない', () => {
    expect(toSsbjReviewNotification(row({ approverUserId: OTHER }), ME, NOW)).toBeNull();
    expect(toSsbjReviewNotification(row({ status: 'draft', reviewRequestedByUserId: null }), ME, NOW)).toBeNull();
    expect(toSsbjReviewNotification(row({ statusChangedAt: null }), ME, NOW)).toBeNull();
  });
});
