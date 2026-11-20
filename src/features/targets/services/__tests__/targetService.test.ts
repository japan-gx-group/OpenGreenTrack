// 削減目標の保存・削除で、閲覧者が RLS に止められたときに権限の文言を出すことの回帰テスト。
// RLS の USING で止められた delete は 0 件で返り、upsert は 42501 で失敗する。
import { beforeEach, describe, expect, it, vi } from 'vitest';

// テーブル・操作ごとに結果を返す簡易クライアント（チェーンはすべて自分を返し、await で結果になる）。
type QueryResult = { data: unknown; error: { code?: string; message: string } | null };
const mocks = vi.hoisted(() => ({
  resolve: (() => ({ data: null, error: null })) as (table: string) => QueryResult,
  throwIfWriteForbidden: vi.fn(),
  calls: [] as { table: string; action: string }[],
}));
vi.mock('@/lib/supabase/client', () => {
  const makeBuilder = (table: string) => {
    let action = 'select';
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'not']) builder[method] = () => builder;
    for (const method of ['delete', 'upsert', 'update', 'insert']) {
      builder[method] = () => {
        action = method;
        return builder;
      };
    }
    const settle = () => {
      mocks.calls.push({ table, action });
      return mocks.resolve(table);
    };
    builder.single = async () => settle();
    builder.then = (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(settle()).then(onFulfilled, onRejected);
    return builder;
  };
  return {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: (table: string) => makeBuilder(table),
    }),
  };
});
vi.mock('@/lib/writePermission', () => ({ throwIfWriteForbidden: mocks.throwIfWriteForbidden }));

const FORBIDDEN = '閲覧者は閲覧のみ可能です。編集はできません';
const profileRow: QueryResult = { data: { organizationId: 'org-1' }, error: null };
const rlsDenied: QueryResult = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };

import { clearReductionTarget, saveReductionTarget } from '../targetService';

beforeEach(() => {
  mocks.calls = [];
  mocks.throwIfWriteForbidden.mockReset();
  mocks.resolve = (table) => (table === 'profiles' ? profileRow : { data: [], error: null });
});

describe('clearReductionTarget', () => {
  it('削除が 0 件で閲覧者なら、権限の文言で失敗させる', async () => {
    mocks.throwIfWriteForbidden.mockRejectedValue(new Error(FORBIDDEN));
    await expect(clearReductionTarget()).rejects.toThrow(FORBIDDEN);
  });

  it('目標が元から無い（0 件で書ける人）ときは成功のまま', async () => {
    await expect(clearReductionTarget()).resolves.toBeUndefined();
    expect(mocks.throwIfWriteForbidden).toHaveBeenCalledTimes(1);
  });

  it('削除できたときは権限を確かめない', async () => {
    mocks.resolve = (table) => (table === 'profiles' ? profileRow : { data: [{ organizationId: 'org-1' }], error: null });
    await expect(clearReductionTarget()).resolves.toBeUndefined();
    expect(mocks.throwIfWriteForbidden).not.toHaveBeenCalled();
  });
});

describe('saveReductionTarget', () => {
  it('基準年度の upsert が RLS で失敗したら、権限の文言で失敗させ、年度ごとの行に進まない', async () => {
    mocks.resolve = (table) => (table === 'profiles' ? profileRow : rlsDenied);
    mocks.throwIfWriteForbidden.mockRejectedValue(new Error(FORBIDDEN));

    await expect(saveReductionTarget('fy-1', [{ targetYear: 2030, reductionPercent: 46 }])).rejects.toThrow(FORBIDDEN);
    expect(mocks.calls.some(call => call.table === 'reduction_target_years')).toBe(false);
  });

  it('書ける人の失敗は今までどおりの文言', async () => {
    mocks.resolve = (table) => (table === 'profiles' ? profileRow : rlsDenied);
    await expect(saveReductionTarget('fy-1', [])).rejects.toThrow('削減目標の保存に失敗しました');
  });
});
