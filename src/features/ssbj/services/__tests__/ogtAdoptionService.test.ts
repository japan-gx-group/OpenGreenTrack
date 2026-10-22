// 採用の取り消し（clearOgtAdoption）が 0 件だったときの扱いを検証する（RLS はマイグレーション側とローカル DB で確かめる）。
// RLS の RESTRICTIVE のポリシーで止められた削除はエラーにならず 0 件になるので、成功にせず、
// ロールで止められたのなら権限のメッセージにする。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSBJ_FORBIDDEN_MESSAGE } from '../../utils/writeError';

const mocks = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  canEdit: true,
  filters: [] as [string, unknown][],
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      delete: () => ({
        eq: (column: string, value: unknown) => {
          mocks.filters.push([column, value]);
          return { select: async () => mocks.result };
        },
      }),
    }),
    rpc: async () => ({ data: mocks.canEdit, error: null }),
  }),
}));

import { clearOgtAdoption } from '../ogtAdoptionService';

const REPORT_ID = '5b1f0000-0000-4000-8000-000000000003';

beforeEach(() => {
  mocks.canEdit = true;
  mocks.filters = [];
});

describe('clearOgtAdoption', () => {
  it('レポートの採用値を削除する', async () => {
    mocks.result = { data: [{ reportId: REPORT_ID }], error: null };
    await expect(clearOgtAdoption(REPORT_ID)).resolves.toBeUndefined();
    expect(mocks.filters).toEqual([['reportId', REPORT_ID]]);
  });

  it('0 件で、ロールが変わって編集できなくなっていたら、成功にせず権限のメッセージにする', async () => {
    mocks.result = { data: [], error: null };
    mocks.canEdit = false;
    await expect(clearOgtAdoption(REPORT_ID)).rejects.toThrow(SSBJ_FORBIDDEN_MESSAGE);
  });

  it('0 件で、編集はできるなら（ほかの画面で取り消し済み）開き直しを促す', async () => {
    mocks.result = { data: [], error: null };
    await expect(clearOgtAdoption(REPORT_ID)).rejects.toThrow('採用済みの値が見つかりません。画面を開き直してください');
  });

  it('承認済み（P2051）は承認済みの案内にする', async () => {
    mocks.result = { data: null, error: { code: 'P2051', message: 'locked' } };
    await expect(clearOgtAdoption(REPORT_ID)).rejects.toThrow('承認済みのレポートは変更できません');
  });
});
