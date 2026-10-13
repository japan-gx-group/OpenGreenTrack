import { describe, expect, it } from 'vitest';
import type { SsbjMemberRoleLog } from '../../types';
import {
  canApproveSsbj,
  canEditSsbj,
  canViewSsbjWorking,
  effectiveSsbjRole,
  isSsbjEffectiveRole,
  isSsbjMemberRole,
  ssbjMemberRoleLogText,
} from '../memberRole';

describe('値の検証', () => {
  it('割り当てられるロールと、判定に使うロール（管理者を含む）を見分ける', () => {
    expect(['editor', 'approver', 'viewer'].every(isSsbjMemberRole)).toBe(true);
    expect(isSsbjMemberRole('admin')).toBe(false);
    expect(isSsbjEffectiveRole('admin')).toBe(true);
    expect(isSsbjEffectiveRole('logger')).toBe(false);
    expect(isSsbjEffectiveRole(null)).toBe(false);
  });
});

describe('effectiveSsbjRole', () => {
  it('OGT の管理者は割り当てに関係なく管理者', () => {
    expect(effectiveSsbjRole('admin', null)).toBe('admin');
    expect(effectiveSsbjRole('admin', 'viewer')).toBe('admin');
  });

  it('割り当てが無ければ入力担当（OGT の logger / viewer は SSBJ のロールに使わない）', () => {
    expect(effectiveSsbjRole('logger', null)).toBe('editor');
    expect(effectiveSsbjRole('viewer', null)).toBe('editor');
    expect(effectiveSsbjRole(null, null)).toBe('editor');
    expect(effectiveSsbjRole('logger', 'approver')).toBe('approver');
  });
});

describe('できることの判定', () => {
  it('編集は入力担当か管理者、閲覧は閲覧者以外、承認は承認担当か管理者', () => {
    expect([canEditSsbj('admin'), canEditSsbj('editor'), canEditSsbj('approver'), canEditSsbj('viewer')])
      .toEqual([true, true, false, false]);
    expect([canViewSsbjWorking('admin'), canViewSsbjWorking('editor'), canViewSsbjWorking('approver'), canViewSsbjWorking('viewer')])
      .toEqual([true, true, true, false]);
    expect([canApproveSsbj('admin'), canApproveSsbj('editor'), canApproveSsbj('approver'), canApproveSsbj('viewer')])
      .toEqual([true, false, true, false]);
  });

  it('ロールが分からない（取得できない・組織の利用者でない）ときは何もできない側に倒す', () => {
    expect([canEditSsbj(null), canViewSsbjWorking(null), canApproveSsbj(null)]).toEqual([false, false, false]);
  });
});

describe('ssbjMemberRoleLogText', () => {
  const log = (overrides: Partial<SsbjMemberRoleLog>): SsbjMemberRoleLog => ({
    id: 1, actorUserId: 'admin', action: 'create', userId: 'user-1', role: 'approver', previousRole: null,
    createdAt: '2026-10-13T00:00:00.000Z', ...overrides,
  });

  it('割り当て・変更・解除を文にする（解除すると入力担当に戻ることも伝える）', () => {
    expect(ssbjMemberRoleLogText(log({}), '確認 三郎')).toBe('確認 三郎 を承認担当にした（割り当て）');
    expect(ssbjMemberRoleLogText(log({ action: 'update', role: 'viewer', previousRole: 'approver' }), '確認 三郎'))
      .toBe('確認 三郎 を承認担当から閲覧者に変えた');
    expect(ssbjMemberRoleLogText(log({ action: 'delete', role: null, previousRole: 'viewer' }), '確認 三郎'))
      .toBe('確認 三郎 の割り当て（閲覧者）を外した（入力担当に戻る）');
  });
});
