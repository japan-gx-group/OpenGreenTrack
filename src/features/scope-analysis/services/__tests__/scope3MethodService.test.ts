// Scope 3 の算定方法の切替・直接入力値の保存で、閲覧者が RLS（42501）に止められたときに
// 権限の文言を出し、集計の更新を呼ばないことの回帰テスト。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { saveScope3CategoryMethod, saveScope3DirectEmissions } from '../scope3MethodService';

const fetchMock = vi.fn();

beforeEach(() => {
  mocks.calls = [];
  mocks.throwIfWriteForbidden.mockReset();
  mocks.resolve = (table) => (table === 'profiles' ? profileRow : rlsDenied);
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveScope3CategoryMethod / saveScope3DirectEmissions', () => {
  it('閲覧者なら権限の文言で失敗させ、集計を更新しない', async () => {
    mocks.throwIfWriteForbidden.mockRejectedValue(new Error(FORBIDDEN));

    await expect(saveScope3CategoryMethod('fy-1', 1, 'direct')).rejects.toThrow(FORBIDDEN);
    await expect(saveScope3DirectEmissions('fy-1', 1, 10)).rejects.toThrow(FORBIDDEN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('書ける人の失敗は今までどおりの文言', async () => {
    await expect(saveScope3CategoryMethod('fy-1', 1, 'direct')).rejects.toThrow('算定方法の切替に失敗しました');
    await expect(saveScope3DirectEmissions('fy-1', 1, 10)).rejects.toThrow('Scope 3カテゴリ別排出量の保存に失敗しました');
  });

  it('保存できたときは権限を確かめない', async () => {
    mocks.resolve = (table) => (table === 'profiles' ? profileRow : { data: null, error: null });

    await saveScope3CategoryMethod('fy-1', 1, 'direct');

    expect(mocks.throwIfWriteForbidden).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
