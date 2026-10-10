import { describe, expect, it } from 'vitest';
import { FICTIONAL_DRAFT_REVIEW } from '../../__fixtures__/fictionalReport';
import type { SsbjReportReview } from '../../types';
import { isSsbjReportLocked, ssbjStatusActions } from '../reportStatus';

const review = (overrides: Partial<SsbjReportReview>): SsbjReportReview => ({ ...FICTIONAL_DRAFT_REVIEW, ...overrides });
const inReview = review({ status: 'in_review', approverUserId: 'approver' });
const approved = review({
  status: 'approved', approverUserId: 'approver', approvedAt: '2025-06-05T00:00:00.000Z',
  approvedByUserId: 'approver', approvedVersionId: 'version-1',
});

describe('isSsbjReportLocked', () => {
  it('承認済みのときだけロックする（レビュー中は編集できる）', () => {
    expect(isSsbjReportLocked(FICTIONAL_DRAFT_REVIEW)).toBe(false);
    expect(isSsbjReportLocked(inReview)).toBe(false);
    expect(isSsbjReportLocked(approved)).toBe(true);
  });
});

describe('ssbjStatusActions', () => {
  it('作成中はレビュー依頼だけ（誰でも）', () => {
    expect(ssbjStatusActions(FICTIONAL_DRAFT_REVIEW, 'logger', 'logger')).toEqual([
      { action: 'submit', allowed: true, reason: null },
    ]);
  });

  it('レビュー中: 承認・差戻しは承認者か管理者だけ、取り下げは誰でも', () => {
    const forLogger = ssbjStatusActions(inReview, 'logger', 'logger');
    expect(forLogger.map(option => [option.action, option.allowed])).toEqual([
      ['approve', false], ['reopen', false], ['withdraw', true],
    ]);
    expect(forLogger[0].reason).toContain('承認者か、管理者');
    expect(ssbjStatusActions(inReview, 'approver', 'logger').every(option => option.allowed)).toBe(true);
    expect(ssbjStatusActions(inReview, 'someone', 'admin').every(option => option.allowed)).toBe(true);
  });

  it('承認済み: 差戻しだけ（承認者か管理者）', () => {
    expect(ssbjStatusActions(approved, 'logger', 'viewer').map(option => [option.action, option.allowed]))
      .toEqual([['reopen', false]]);
    expect(ssbjStatusActions(approved, 'approver', 'viewer')[0].allowed).toBe(true);
  });

  it('自己承認: レビューを依頼した本人は、管理者でも承認できない（差戻し・取り下げはできる）', () => {
    const requestedByAdmin = review({ status: 'in_review', approverUserId: 'approver', reviewRequestedByUserId: 'admin-user' });
    const options = ssbjStatusActions(requestedByAdmin, 'admin-user', 'admin');
    expect(options.map(option => [option.action, option.allowed])).toEqual([
      ['approve', false], ['reopen', true], ['withdraw', true],
    ]);
    expect(options[0].reason).toContain('レビューを依頼した本人は承認できません');
    // 指定された承認者は承認できる。
    expect(ssbjStatusActions(requestedByAdmin, 'approver', 'logger')[0].allowed).toBe(true);
  });

  it('自己承認: サーバが返した理由（依頼の後に変更した）があれば承認させず、理由を出す', () => {
    const options = ssbjStatusActions(inReview, 'approver', 'logger', 'edited_after_request');
    expect(options[0]).toEqual({
      action: 'approve', allowed: false, reason: expect.stringContaining('レビューの依頼の後に内容を変更したため'),
    });
    // 承認の権限が無い人には、権限の理由のほうを出す。
    expect(ssbjStatusActions(inReview, 'logger', 'logger', 'edited_after_request')[0].reason).toContain('承認者か、管理者');
  });

  it('ログインしていない（ID が無い）ときは承認者とみなさない', () => {
    expect(ssbjStatusActions(review({ status: 'in_review', approverUserId: null }), null, null)[0].allowed).toBe(false);
  });
});
