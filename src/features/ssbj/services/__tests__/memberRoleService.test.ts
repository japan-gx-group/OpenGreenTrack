import { afterEach, describe, expect, it, vi } from 'vitest';

// SSBJ のロールの取得・割り当て（更新して、無ければ作る）と、変更の記録の変換を検証する
// （RLS・トリガーはマイグレーション側とローカル DB で確認する）。
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  updateSelect: vi.fn(),
  insert: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: mocks.select,
      update: (columns: unknown) => {
        mocks.update(columns);
        return { eq: () => ({ select: mocks.updateSelect }) };
      },
      insert: mocks.insert,
    }),
    rpc: mocks.rpc,
  }),
}));

import { SSBJ_FORBIDDEN_MESSAGE } from '../../utils/writeError';
import {
  assignSsbjMemberRole,
  getMySsbjRole,
  listSsbjMemberRoles,
  throwIfSsbjEditForbidden,
  toSsbjMemberRoleLog,
} from '../memberRoleService';

afterEach(() => vi.clearAllMocks());

describe('listSsbjMemberRoles', () => {
  it('利用者 ID → ロールにする。知らない値は補正せず例外にする', async () => {
    mocks.select.mockResolvedValue({ data: [{ userId: 'u1', role: 'approver' }, { userId: 'u2', role: 'viewer' }], error: null });
    expect([...(await listSsbjMemberRoles()).entries()]).toEqual([['u1', 'approver'], ['u2', 'viewer']]);
    mocks.select.mockResolvedValue({ data: [{ userId: 'u1', role: 'admin' }], error: null });
    await expect(listSsbjMemberRoles()).rejects.toThrow('SSBJ のロールが不正です');
  });
});

describe('getMySsbjRole', () => {
  it('ログイン中の利用者のロールを返す（組織の利用者でなければ null）', async () => {
    mocks.rpc.mockResolvedValue({ data: 'admin', error: null });
    await expect(getMySsbjRole()).resolves.toBe('admin');
    expect(mocks.rpc).toHaveBeenCalledWith('ssbj_current_user_role');
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMySsbjRole()).resolves.toBeNull();
    mocks.rpc.mockResolvedValue({ data: 'logger', error: null });
    await expect(getMySsbjRole()).rejects.toThrow('SSBJ のロールが不正です');
  });
});

describe('throwIfSsbjEditForbidden', () => {
  it('今は編集できない（ロールが変わった）なら、権限のメッセージで例外にする', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(throwIfSsbjEditForbidden()).rejects.toThrow(SSBJ_FORBIDDEN_MESSAGE);
    expect(mocks.rpc).toHaveBeenCalledWith('ssbj_current_user_can_edit');
  });

  it('編集できる・確かめられないときは何もしない（呼び出し元の案内のままにする）', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(throwIfSsbjEditForbidden()).resolves.toBeUndefined();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(throwIfSsbjEditForbidden()).resolves.toBeUndefined();
  });
});

describe('assignSsbjMemberRole', () => {
  it('割り当てがあれば更新する（作らない）', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [{ userId: 'u1' }], error: null });
    await assignSsbjMemberRole('u1', 'viewer');
    expect(mocks.update).toHaveBeenCalledWith({ role: 'viewer' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('割り当てが無ければ、自組織を確かめて作る', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockResolvedValue({ data: 'org-1', error: null });
    mocks.insert.mockResolvedValue({ error: null });
    await assignSsbjMemberRole('u1', 'approver');
    expect(mocks.rpc).toHaveBeenCalledWith('current_user_organization_id');
    expect(mocks.insert).toHaveBeenCalledWith({ organizationId: 'org-1', userId: 'u1', role: 'approver' });
  });

  it('管理者でない（RLS が拒否する）ときは、その理由を伝える', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockResolvedValue({ data: 'org-1', error: null });
    mocks.insert.mockResolvedValue({ error: { code: '42501', message: 'new row violates row-level security policy' } });
    await expect(assignSsbjMemberRole('u1', 'approver')).rejects.toThrow('管理者のみ変更できます');
  });

  it('別の画面で同時に最初の割り当てが作られたときは、開き直しを促す', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockResolvedValue({ data: 'org-1', error: null });
    mocks.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    await expect(assignSsbjMemberRole('u1', 'approver')).rejects.toThrow('画面を開き直してください');
  });
});

describe('toSsbjMemberRoleLog', () => {
  const row = { id: 3, actorUserId: 'admin', action: 'update', targetId: 'u1', details: { role: 'viewer', previousRole: 'approver' },
    createdAt: '2026-10-13T00:00:00Z' };

  it('記録を変更の内容にする', () => {
    expect(toSsbjMemberRoleLog(row)).toEqual({
      id: 3, actorUserId: 'admin', action: 'update', userId: 'u1', role: 'viewer', previousRole: 'approver',
      memberDeleted: false, createdAt: '2026-10-13T00:00:00Z',
    });
  });

  it('利用者の削除に伴う解除（操作者は空・details.reason = member_deleted）を見分ける', () => {
    const log = toSsbjMemberRoleLog({
      ...row, actorUserId: null, action: 'delete', details: { previousRole: 'viewer', reason: 'member_deleted' },
    });
    expect(log).toMatchObject({ actorUserId: null, action: 'delete', role: null, previousRole: 'viewer', memberDeleted: true });
  });

  it('操作・対象が不正な記録は補正せず例外にする', () => {
    expect(() => toSsbjMemberRoleLog({ ...row, action: 'export' })).toThrow('記録が不正です');
    expect(() => toSsbjMemberRoleLog({ ...row, targetId: null })).toThrow('記録が不正です');
  });
});
