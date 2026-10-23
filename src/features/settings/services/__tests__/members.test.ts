import { beforeEach, describe, expect, it, vi } from 'vitest';

// saveMemberChanges（Server Action）の検証。DB とログイン情報はモックし、
// 管理者の確認・反映の順番・エラーの伝え方・監査ログを確かめる。変更の組み立ては実物（memberChangePlan）を通す。

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  calls: [] as string[],
  members: [] as { id: string; role: string }[],
  rpcError: null as null | { code?: string; message: string },
  rpcErrorAt: -1,
  deleteUserError: null as null | { message: string },
  auditInserts: [] as Record<string, unknown>[],
  logError: vi.fn(),
}));

vi.mock('@/lib/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz')>()),
  requireAdmin: mocks.requireAdmin,
}));

vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => ({ error: mocks.logError }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: async () => ({ data: mocks.members, error: null }),
          }),
        };
      }
      if (table === 'system_audit_logs') {
        return {
          insert: async (row: Record<string, unknown>) => {
            mocks.auditInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (name: string, args: Record<string, string>) => {
      const index = mocks.calls.length;
      mocks.calls.push(`${name}:${args.p_target_user_id}:${args.p_role}`);
      if (index === mocks.rpcErrorAt) {
        return { data: null, error: mocks.rpcError };
      }
      return { data: { changed: true }, error: null };
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          mocks.calls.push(`deleteUser:${id}`);
          return { error: mocks.deleteUserError };
        },
      },
    },
  }),
}));

import { saveMemberChanges } from '../members';

const caller = { id: 'admin-1', organizationId: 'org-1', email: 'a@example.com', fullName: null, role: 'admin' };

describe('saveMemberChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls = [];
    mocks.auditInserts = [];
    mocks.rpcError = null;
    mocks.rpcErrorAt = -1;
    mocks.deleteUserError = null;
    mocks.members = [
      { id: 'admin-1', role: 'admin' },
      { id: 'member-1', role: 'logger' },
      { id: 'member-2', role: 'viewer' },
    ];
    mocks.requireAdmin.mockResolvedValue({ ok: true, profile: caller });
  });

  it('管理者でなければ、DB に触れずに断る', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, error: '管理者のみ操作できます' });
    const result = await saveMemberChanges({ removedMemberIds: ['member-1'] });
    expect(result).toEqual({ ok: false, error: '管理者のみ操作できます' });
    expect(mocks.calls).toEqual([]);
  });

  it('管理者への昇格 → メンバーへの降格 → 削除の順に反映し、削除を監査ログに残す', async () => {
    const result = await saveMemberChanges({
      removedMemberIds: ['member-2'],
      roleChanges: [
        { memberId: 'admin-1', role: 'logger' },
        { memberId: 'member-1', role: 'admin' },
      ],
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.calls).toEqual([
      'change_member_role:member-1:admin',
      'change_member_role:admin-1:logger',
      'deleteUser:member-2',
    ]);
    expect(mocks.auditInserts).toEqual([
      {
        organizationId: 'org-1',
        userId: 'admin-1',
        action: 'member.remove',
        entityName: 'profiles',
        entityId: 'member-2',
        detail: JSON.stringify({ role: 'viewer' }),
      },
    ]);
  });

  it('管理者が 0 人になる変更は、反映を始める前に断る', async () => {
    const result = await saveMemberChanges({
      removedMemberIds: [],
      roleChanges: [{ memberId: 'admin-1', role: 'logger' }],
    });
    expect(result).toEqual({ ok: false, error: '管理者が 1 人もいなくなるため変更できません' });
    expect(mocks.calls).toEqual([]);
  });

  it('RPC が SQLSTATE で断ったら、そのメッセージに反映済みの件数を添えて止める', async () => {
    mocks.members.push({ id: 'admin-2', role: 'admin' });
    mocks.rpcErrorAt = 1;
    mocks.rpcError = { code: 'P2081', message: 'last admin' };
    const result = await saveMemberChanges({
      removedMemberIds: ['member-2'],
      roleChanges: [
        { memberId: 'member-1', role: 'admin' },
        { memberId: 'admin-2', role: 'logger' },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: '管理者が 1 人もいなくなるため変更できません（1 件は反映済みです）',
    });
    // 失敗した後の削除には進まない
    expect(mocks.calls).toEqual([
      'change_member_role:member-1:admin',
      'change_member_role:admin-2:logger',
    ]);
  });

  it('想定外の RPC のエラーは一般的なメッセージにし、ログに残す', async () => {
    mocks.rpcErrorAt = 0;
    mocks.rpcError = { code: 'XX000', message: 'boom' };
    const result = await saveMemberChanges({
      removedMemberIds: [],
      roleChanges: [{ memberId: 'member-1', role: 'admin' }],
    });
    expect(result).toEqual({ ok: false, error: 'ロールの変更に失敗しました' });
    expect(mocks.logError).toHaveBeenCalled();
  });

  it('削除に失敗したら止め、監査ログは残さない', async () => {
    mocks.deleteUserError = { message: 'failed' };
    const result = await saveMemberChanges({ removedMemberIds: ['member-1'] });
    expect(result).toEqual({ ok: false, error: 'メンバーの削除に失敗しました' });
    expect(mocks.auditInserts).toEqual([]);
  });

  it('変更が無ければ何もしない', async () => {
    const result = await saveMemberChanges({ removedMemberIds: [], roleChanges: [] });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.calls).toEqual([]);
  });
});
