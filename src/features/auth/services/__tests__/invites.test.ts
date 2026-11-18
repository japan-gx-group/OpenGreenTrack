import { beforeEach, describe, expect, it, vi } from 'vitest';

// acceptInvite（Server Action）の検証。DB はモックし、招待のロールが profiles にそのまま写ることを確かめる。

const TOKEN = '11111111-1111-1111-1111-111111111111';

const mocks = vi.hoisted(() => ({
  invite: null as null | Record<string, unknown>,
  profileInserts: [] as Record<string, unknown>[],
}));

// supabase-js のクエリビルダーの形（メソッドを繋いで最後に maybeSingle / await で結果を得る）だけを再現する。
const chain = (result: unknown) => {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'update']) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return builder;
};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'invites') {
        return {
          select: () => chain({ data: mocks.invite, error: null }),
          update: () => chain({ data: { token: TOKEN }, error: null }),
        };
      }
      if (table === 'profiles') {
        return {
          insert: async (row: Record<string, unknown>) => {
            mocks.profileInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        createUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
        deleteUser: async () => ({ error: null }),
      },
    },
  }),
}));

import { acceptInvite } from '../invites';

describe('acceptInvite', () => {
  beforeEach(() => {
    mocks.profileInserts = [];
    mocks.invite = {
      token: TOKEN,
      organizationId: 'org-1',
      email: 'Reader@Example.com',
      role: 'viewer',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      acceptedAt: null,
    };
  });

  it('閲覧者の招待を受け取ると、閲覧者として組織に参加する', async () => {
    const result = await acceptInvite({ token: TOKEN, fullName: '閲覧 太郎', password: 'password123' });

    expect(result).toEqual({ ok: true, data: { email: 'reader@example.com' } });
    expect(mocks.profileInserts).toEqual([
      {
        id: 'user-1',
        organizationId: 'org-1',
        email: 'reader@example.com',
        fullName: '閲覧 太郎',
        role: 'viewer',
      },
    ]);
  });
});
