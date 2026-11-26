import { afterEach, describe, expect, it, vi } from 'vitest';

// 操作履歴の DB 行 ⇔ 画面の型の変換と、出力の記録の失敗の扱いを検証する（RLS・書き換え拒否はマイグレーション側で確認する）。
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

import { getLatestSsbjStatusChange, recordSsbjExport, toSsbjAuditLog } from '../auditLogService';

const row = {
  id: 7, reportId: 'report-1', actorUserId: 'user-1', action: 'status_change', targetType: 'report',
  targetId: 'report-1', changedColumns: null, details: { operation: 'approve' }, createdAt: '2025-06-05T00:00:00Z',
};

afterEach(() => vi.clearAllMocks());

describe('toSsbjAuditLog', () => {
  it('DB 行を操作履歴に戻す（details がオブジェクトでなければ空にする）', () => {
    expect(toSsbjAuditLog(row)).toEqual({ ...row, action: 'status_change' });
    expect(toSsbjAuditLog({ ...row, details: null }).details).toEqual({});
  });

  it('操作の種類が不明な行は補正せず例外にする', () => {
    expect(() => toSsbjAuditLog({ ...row, action: 'rename' })).toThrow('操作履歴の操作が不正です');
  });
});

describe('recordSsbjExport', () => {
  it('レポート・形式・版を渡して記録する', async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    await recordSsbjExport('report-1', 'xlsx', 'version-1');
    expect(mocks.rpc).toHaveBeenCalledWith('record_ssbj_export', {
      p_report_id: 'report-1', p_format: 'xlsx', p_version_id: 'version-1',
    });
  });

  it('記録できなければ例外にする（呼び出し元は出力を中止する）', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P2031', message: 'not found' } });
    await expect(recordSsbjExport('report-1', 'audit_csv')).rejects.toThrow('出力を中止しました');
  });
});

describe('getLatestSsbjStatusChange', () => {
  it('レポートの状態の変更を新しい順に 1 件だけ読み、行を操作履歴に戻す', async () => {
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    };
    mocks.from.mockReturnValue(query);
    await expect(getLatestSsbjStatusChange('report-1')).resolves.toEqual({ ...row, action: 'status_change' });
    expect(mocks.from).toHaveBeenCalledWith('ssbj_audit_logs');
    expect(query.eq).toHaveBeenCalledWith('reportId', 'report-1');
    expect(query.eq).toHaveBeenCalledWith('action', 'status_change');
    expect(query.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it('記録が無ければ null、読めなければ例外にする', async () => {
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    mocks.from.mockReturnValue(query);
    await expect(getLatestSsbjStatusChange('report-1')).resolves.toBeNull();
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'denied' } } as never);
    await expect(getLatestSsbjStatusChange('report-1')).rejects.toThrow('差戻しの理由の取得に失敗しました');
  });
});
