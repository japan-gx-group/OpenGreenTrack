import { afterEach, describe, expect, it, vi } from 'vitest';

// 承認できない理由の問い合わせ: 値の検証と失敗の扱いを検証する（判定そのものはマイグレーション側とローカル DB で確認する）。
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

import { getMySsbjApprovalBlocker } from '../approvalBlockerService';

afterEach(() => vi.clearAllMocks());

describe('getMySsbjApprovalBlocker', () => {
  it('レポートを渡して問い合わせ、理由（承認してよければ null）を返す', async () => {
    mocks.rpc.mockResolvedValue({ data: 'requester', error: null });
    await expect(getMySsbjApprovalBlocker('report-1')).resolves.toBe('requester');
    expect(mocks.rpc).toHaveBeenCalledWith('ssbj_my_approval_blocker', { p_report_id: 'report-1' });

    mocks.rpc.mockResolvedValue({ data: 'edited_after_request', error: null });
    await expect(getMySsbjApprovalBlocker('report-1')).resolves.toBe('edited_after_request');
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMySsbjApprovalBlocker('report-1')).resolves.toBeNull();
  });

  it('知らない値は補正せず例外にし、問い合わせの失敗も例外にする', async () => {
    mocks.rpc.mockResolvedValue({ data: 'someone_else', error: null });
    await expect(getMySsbjApprovalBlocker('report-1')).rejects.toThrow('確認結果が不正です');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P2031', message: 'not found' } });
    await expect(getMySsbjApprovalBlocker('report-1')).rejects.toThrow('承認できるかどうかを確認できませんでした');
  });
});
