import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

import { WRITE_FORBIDDEN_MESSAGE, throwIfWriteForbidden } from '../writePermission';

describe('throwIfWriteForbidden', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DB が書けないと答えたら権限の文言で投げる', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(throwIfWriteForbidden()).rejects.toThrow(WRITE_FORBIDDEN_MESSAGE);
    expect(mocks.rpc).toHaveBeenCalledWith('current_user_can_edit');
  });

  it('書けるなら何もしない（呼び出し元の案内のままにする）', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(throwIfWriteForbidden()).resolves.toBeUndefined();
  });

  it('確かめられないとき（エラー・通信の失敗）は何もしない', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(throwIfWriteForbidden()).resolves.toBeUndefined();
    mocks.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(throwIfWriteForbidden()).resolves.toBeUndefined();
  });
});
