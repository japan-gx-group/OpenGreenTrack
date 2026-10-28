import { beforeEach, describe, expect, it, vi } from 'vitest';

// 招待の発行・取り消し（Server Action）の検証。管理者の確認・招待のロール・監査ログを確かめる。
// DB（セッション付きクライアント）とログイン情報はモックし、招待メールは未設定の扱いにする。

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  inviteInserts: [] as Record<string, unknown>[],
  auditInserts: [] as Record<string, unknown>[],
  deletedInvite: null as null | { token: string; email: string },
  calls: [] as string[],
}));

vi.mock('@/lib/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz')>()),
  requireAdmin: mocks.requireAdmin,
}));

vi.mock('../inviteEmail', () => ({
  isInviteEmailConfigured: () => false,
  sendInviteEmail: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      mocks.calls.push(table);
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
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
      // invites
      return {
        delete: () => ({
          eq: () => ({
            eq: () => ({ is: async () => ({ error: null }) }),
            is: () => ({
              select: () => ({ maybeSingle: async () => ({ data: mocks.deletedInvite, error: null }) }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          mocks.inviteInserts.push(row);
          return {
            select: () => ({
              single: async () => ({
                data: { token: '11111111-1111-1111-1111-111111111111', email: row.email, expiresAt: '2026-11-01T00:00:00Z' },
                error: null,
              }),
            }),
          };
        },
      };
    },
  }),
}));

import { createInvite, revokeInvite } from '../invites';

const admin = { id: 'admin-1', organizationId: 'org-1', email: 'a@example.com', fullName: null, role: 'admin' };

describe('createInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inviteInserts = [];
    mocks.auditInserts = [];
    mocks.calls = [];
    mocks.requireAdmin.mockResolvedValue({ ok: true, profile: admin });
  });

  it('管理者でなければ、DB に触れずに断る', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, error: '管理者のみ操作できます' });
    const result = await createInvite({ email: 'new@example.com' });
    expect(result).toEqual({ ok: false, error: '管理者のみ操作できます' });
    expect(mocks.calls).toEqual([]);
  });

  it('ロールを省略するとメンバー（logger）として招待し、発行を監査ログに残す', async () => {
    const result = await createInvite({ email: 'New@Example.com ' });
    expect(result.ok).toBe(true);
    expect(mocks.inviteInserts).toEqual([
      { organizationId: 'org-1', email: 'new@example.com', role: 'logger' },
    ]);
    expect(mocks.auditInserts).toEqual([
      {
        organizationId: 'org-1',
        action: 'invite.create',
        entityName: 'invites',
        detail: JSON.stringify({ email: 'new@example.com', role: 'logger' }),
      },
    ]);
  });

  it('管理者として招待できる', async () => {
    await createInvite({ email: 'boss@example.com', role: 'admin' });
    expect(mocks.inviteInserts[0]).toMatchObject({ role: 'admin' });
  });

  it('書けないロール（viewer など）は断る', async () => {
    const result = await createInvite({ email: 'new@example.com', role: 'viewer' as never });
    expect(result).toEqual({ ok: false, error: 'ロールの値が正しくありません' });
    expect(mocks.inviteInserts).toEqual([]);
  });

  it('監査ログに招待リンクの token を残さない（監査ログはメンバー全員が読めるため）', async () => {
    await createInvite({ email: 'new@example.com' });
    expect(JSON.stringify(mocks.auditInserts)).not.toContain('11111111-1111-1111-1111-111111111111');
  });
});

describe('revokeInvite', () => {
  const token = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditInserts = [];
    mocks.calls = [];
    mocks.deletedInvite = { token, email: 'new@example.com' };
    mocks.requireAdmin.mockResolvedValue({ ok: true, profile: admin });
  });

  it('管理者でなければ、DB に触れずに断る', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, error: '管理者のみ操作できます' });
    const result = await revokeInvite(token);
    expect(result).toEqual({ ok: false, error: '管理者のみ操作できます' });
    expect(mocks.calls).toEqual([]);
  });

  it('取り消しを監査ログに残す（招待先のメールアドレスだけ）', async () => {
    const result = await revokeInvite(token);
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.auditInserts).toEqual([
      {
        organizationId: 'org-1',
        action: 'invite.revoke',
        entityName: 'invites',
        detail: JSON.stringify({ email: 'new@example.com' }),
      },
    ]);
  });

  it('すでに使われた・取り消された招待なら、監査ログは残さない', async () => {
    mocks.deletedInvite = null;
    const result = await revokeInvite(token);
    expect(result).toEqual({ ok: false, error: 'この招待は既に使用済みか、取り消されています' });
    expect(mocks.auditInserts).toEqual([]);
  });
});
