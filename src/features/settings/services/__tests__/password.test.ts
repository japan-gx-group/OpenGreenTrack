import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cookie セッション・使い捨てクライアント・admin client をすべてモックし、
// 「現在のパスワードの検証 → admin API で更新」の順序と、失敗時に更新へ進まないことを守る。
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.updateUserById } } }),
}));

import { changePassword } from '../password';

describe('changePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } });
    mocks.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('現在のパスワードを検証してから、セッションのユーザー自身を admin API で更新する', async () => {
    const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'new-pass-123' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'old-pass' });
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { password: 'new-pass-123' });
  });

  it('現在のパスワードが違えば更新しない', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid' } });

    const result = await changePassword({ currentPassword: 'wrong', newPassword: 'new-pass-123' });

    expect(result).toEqual({ ok: false, error: '現在のパスワードが正しくありません' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('未ログインなら検証も更新もしない', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'new-pass-123' });

    expect(result.ok).toBe(false);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('新パスワードが8文字未満なら弾く（サーバ側でも検証する）', async () => {
    const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'short' });

    expect(result).toEqual({ ok: false, error: 'パスワードは8文字以上である必要があります。' });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('admin API が失敗したらエラーを返す', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const result = await changePassword({ currentPassword: 'old-pass', newPassword: 'new-pass-123' });

    expect(result).toEqual({ ok: false, error: 'パスワードの更新に失敗しました' });
  });
});
