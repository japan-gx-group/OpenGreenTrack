import { beforeEach, describe, expect, it, vi } from 'vitest';

// next/headers の cookies()・Cookie セッション・admin client をモックし、
// 「マーカー Cookie と recovery セッションの両方が揃ったときだけ更新し、更新後にマーカーを消す」ことを守る。
const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
  getUser: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, delete: mocks.cookieDelete }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.updateUserById } } }),
}));

import { completePasswordRecovery } from '../passwordRecovery';

describe('completePasswordRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ name: 'pw-recovery', value: '1' });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
  });

  it('マーカーと recovery セッションが揃っていれば更新し、マーカーを消す', async () => {
    const result = await completePasswordRecovery('new-pass-123');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.cookieGet).toHaveBeenCalledWith('pw-recovery');
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { password: 'new-pass-123' });
    expect(mocks.cookieDelete).toHaveBeenCalledWith('pw-recovery');
  });

  it('マーカー Cookie が無ければ更新しない（ただログイン中の人からの呼び出し）', async () => {
    mocks.cookieGet.mockReturnValue(undefined);

    const result = await completePasswordRecovery('new-pass-123');

    expect(result.ok).toBe(false);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it('recovery セッションが無ければ更新しない', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await completePasswordRecovery('new-pass-123');

    expect(result.ok).toBe(false);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('8文字未満は弾く', async () => {
    const result = await completePasswordRecovery('short');

    expect(result).toEqual({ ok: false, error: 'パスワードは8文字以上で入力してください。' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('admin API が失敗したらマーカーを残したままエラーを返す', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const result = await completePasswordRecovery('new-pass-123');

    expect(result).toEqual({ ok: false, error: 'パスワードの更新に失敗しました' });
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });
});
