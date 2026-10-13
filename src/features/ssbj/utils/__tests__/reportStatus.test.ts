import { describe, expect, it } from 'vitest';
import { FICTIONAL_DRAFT_REVIEW } from '../../__fixtures__/fictionalReport';
import type { SsbjReportReview } from '../../types';
import { isSsbjReportLocked, ssbjStatusActions } from '../reportStatus';

const review = (overrides: Partial<SsbjReportReview>): SsbjReportReview => ({ ...FICTIONAL_DRAFT_REVIEW, ...overrides });
const inReview = review({ status: 'in_review', approverUserId: 'approver', reviewRequestedByUserId: 'writer' });
const approved = review({
  status: 'approved', approverUserId: 'approver', approvedAt: '2025-06-05T00:00:00.000Z',
  approvedByUserId: 'approver', approvedVersionId: 'version-1', reviewRequestedByUserId: 'writer',
});

describe('isSsbjReportLocked', () => {
  it('承認済みのときだけロックする（レビュー中は編集できる）', () => {
    expect(isSsbjReportLocked(FICTIONAL_DRAFT_REVIEW)).toBe(false);
    expect(isSsbjReportLocked(inReview)).toBe(false);
    expect(isSsbjReportLocked(approved)).toBe(true);
  });
});

describe('ssbjStatusActions', () => {
  it('作成中: レビュー依頼は入力担当か管理者だけ', () => {
    expect(ssbjStatusActions(FICTIONAL_DRAFT_REVIEW, 'writer', 'editor')).toEqual([
      { action: 'submit', allowed: true, reason: null },
    ]);
    expect(ssbjStatusActions(FICTIONAL_DRAFT_REVIEW, 'admin-user', 'admin')[0].allowed).toBe(true);
    for (const role of ['approver', 'viewer', null] as const) {
      const [submit] = ssbjStatusActions(FICTIONAL_DRAFT_REVIEW, 'someone', role);
      expect(submit.allowed).toBe(false);
      expect(submit.reason).toContain('入力担当か管理者だけ');
    }
  });

  it('レビュー中: 承認・差戻しは指定された承認者（承認担当）か管理者だけ、取り下げは入力担当か管理者', () => {
    const forEditor = ssbjStatusActions(inReview, 'someone', 'editor');
    expect(forEditor.map(option => [option.action, option.allowed])).toEqual([
      ['approve', false], ['reopen', false], ['withdraw', true],
    ]);
    expect(forEditor[0].reason).toContain('承認担当か管理者だけ');
    expect(ssbjStatusActions(inReview, 'approver', 'approver').map(option => [option.action, option.allowed])).toEqual([
      ['approve', true], ['reopen', true], ['withdraw', false],
    ]);
    expect(ssbjStatusActions(inReview, 'someone', 'admin').every(option => option.allowed)).toBe(true);
  });

  it('レビュー中: 承認担当でも、指定された承認者でなければ承認・差戻しできない', () => {
    const [approve, reopen] = ssbjStatusActions(inReview, 'other-approver', 'approver');
    expect([approve.allowed, reopen.allowed]).toEqual([false, false]);
    expect(approve.reason).toContain('指定された承認者か、管理者');
  });

  it('レビュー中: 指定された承認者でも、ロールが承認担当でなければ承認できない（承認者は承認担当か管理者）', () => {
    expect(ssbjStatusActions(inReview, 'approver', 'editor')[0].allowed).toBe(false);
  });

  it('承認済み: 差戻しだけ（指定された承認者か管理者）', () => {
    expect(ssbjStatusActions(approved, 'writer', 'editor').map(option => [option.action, option.allowed]))
      .toEqual([['reopen', false]]);
    expect(ssbjStatusActions(approved, 'approver', 'approver')[0].allowed).toBe(true);
    expect(ssbjStatusActions(approved, 'someone', 'viewer')[0].allowed).toBe(false);
  });

  it('自己承認: レビューを依頼した本人は、管理者でも承認できない（差戻し・取り下げはできる）', () => {
    const requestedByAdmin = review({ status: 'in_review', approverUserId: 'approver', reviewRequestedByUserId: 'admin-user' });
    const options = ssbjStatusActions(requestedByAdmin, 'admin-user', 'admin');
    expect(options.map(option => [option.action, option.allowed])).toEqual([
      ['approve', false], ['reopen', true], ['withdraw', true],
    ]);
    expect(options[0].reason).toContain('レビューを依頼した本人は承認できません');
    // 指定された承認者は承認できる。
    expect(ssbjStatusActions(requestedByAdmin, 'approver', 'approver')[0].allowed).toBe(true);
  });

  it('自己承認: サーバが返した理由（依頼の後に変更した）があれば承認させず、理由を出す', () => {
    const options = ssbjStatusActions(inReview, 'approver', 'approver', 'edited_after_request');
    expect(options[0]).toEqual({
      action: 'approve', allowed: false, reason: expect.stringContaining('レビューの依頼の後に内容を変更したため'),
    });
    // 承認の権限が無い人には、権限の理由のほうを出す。
    expect(ssbjStatusActions(inReview, 'someone', 'editor', 'edited_after_request')[0].reason).toContain('承認担当か管理者');
  });

  it('ログインしていない・ロールが分からないときは何もさせない', () => {
    const options = ssbjStatusActions(review({ status: 'in_review', approverUserId: null }), null, null);
    expect(options.every(option => !option.allowed)).toBe(true);
  });
});
