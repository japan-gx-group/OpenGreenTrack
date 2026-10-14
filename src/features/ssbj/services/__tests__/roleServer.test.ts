import { afterEach, describe, expect, it, vi } from 'vitest';

// SSBJ のロールの確認（サーバ側）: DB の ssbj_user_role を引き、操作に要る権限と照らす。
// 判定の規則の正本は DB とマイグレーションのテストで、ここでは呼び方と結果の扱いを検証する。
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { denySsbjRole, getSsbjUserRole, guardSsbjRole } from '../roleServer';

const actor = { id: 'user-1', organizationId: 'org-1' };

afterEach(() => vi.clearAllMocks());

describe('getSsbjUserRole', () => {
  it('操作者と組織を渡してロールを引く（組織の利用者でなければ null）', async () => {
    mocks.rpc.mockResolvedValue({ data: 'approver', error: null });
    await expect(getSsbjUserRole('user-1', 'org-1')).resolves.toBe('approver');
    expect(mocks.rpc).toHaveBeenCalledWith('ssbj_user_role', { p_user_id: 'user-1', p_organization_id: 'org-1' });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getSsbjUserRole('user-1', 'org-1')).resolves.toBeNull();
  });

  it('知らない値・取得の失敗は例外にする', async () => {
    mocks.rpc.mockResolvedValue({ data: 'logger', error: null });
    await expect(getSsbjUserRole('user-1', 'org-1')).rejects.toThrow('SSBJ のロールが不正です');
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(getSsbjUserRole('user-1', 'org-1')).rejects.toThrow('SSBJ のロールの取得に失敗しました');
  });
});

describe('denySsbjRole', () => {
  it.each([
    ['admin', 'edit', null],
    ['editor', 'edit', null],
    ['approver', 'edit', 403],
    ['viewer', 'view_working', 403],
    ['approver', 'view_working', null],
    ['approver', 'approve', null],
    ['editor', 'approve', 403],
  ] as const)('%s に %s は %s', async (role, permission, status) => {
    mocks.rpc.mockResolvedValue({ data: role, error: null });
    const denial = await denySsbjRole(actor, permission);
    if (status === null) {
      expect(denial).toBeNull();
    } else {
      expect(denial?.status).toBe(403);
    }
  });

  it('拒否のメッセージはロールと、誰ならできるかを伝える', async () => {
    mocks.rpc.mockResolvedValue({ data: 'viewer', error: null });
    expect((await denySsbjRole(actor, 'edit'))?.error)
      .toBe('SSBJ のロールが閲覧者のため、この操作はできません。レポートの内容を変える操作は、入力担当か管理者だけができます');
  });
});

describe('guardSsbjRole', () => {
  it('ロールを確かめられなければ、ログに渡して 500 にする', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const onError = vi.fn();
    await expect(guardSsbjRole(actor, 'edit', onError)).resolves.toEqual({ status: 500, error: 'サーバー内部エラーが発生しました' });
    expect(onError).toHaveBeenCalled();
  });

  it('許すときは null、許さないときは 403 をそのまま返す', async () => {
    mocks.rpc.mockResolvedValue({ data: 'editor', error: null });
    await expect(guardSsbjRole(actor, 'edit', vi.fn())).resolves.toBeNull();
    await expect(guardSsbjRole(actor, 'approve', vi.fn())).resolves.toMatchObject({ status: 403 });
  });
});
