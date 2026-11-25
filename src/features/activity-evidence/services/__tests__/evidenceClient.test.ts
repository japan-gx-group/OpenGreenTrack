// 帳票の紐づけ・外しで、閲覧者が RLS に止められたときに権限の文言を出すことの回帰テスト。
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
const rlsDenied: QueryResult = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };

import { linkEvidence, unlinkEvidence } from '../evidenceClient';

beforeEach(() => {
  mocks.calls = [];
  mocks.throwIfWriteForbidden.mockReset();
});

describe('unlinkEvidence', () => {
  it('外せた行が 0 件で閲覧者なら、権限の文言で失敗させる', async () => {
    mocks.resolve = () => ({ data: [], error: null });
    mocks.throwIfWriteForbidden.mockRejectedValue(new Error(FORBIDDEN));
    await expect(unlinkEvidence('rec-1', 'file-1')).rejects.toThrow(FORBIDDEN);
  });

  it('外せたときは権限を確かめない', async () => {
    mocks.resolve = () => ({ data: [{ evidenceFileId: 'file-1' }], error: null });
    await expect(unlinkEvidence('rec-1', 'file-1')).resolves.toBeUndefined();
    expect(mocks.throwIfWriteForbidden).not.toHaveBeenCalled();
  });
});

describe('linkEvidence', () => {
  it('紐づけが RLS で失敗して閲覧者なら、権限の文言で失敗させる', async () => {
    mocks.resolve = (table) =>
      table === 'activity_records' ? { data: { organizationId: 'org-1' }, error: null } : rlsDenied;
    mocks.throwIfWriteForbidden.mockRejectedValue(new Error(FORBIDDEN));
    await expect(linkEvidence('rec-1', ['file-1'])).rejects.toThrow(FORBIDDEN);
  });

  it('書ける人の失敗は今までどおりの文言', async () => {
    mocks.resolve = (table) =>
      table === 'activity_records' ? { data: { organizationId: 'org-1' }, error: null } : rlsDenied;
    await expect(linkEvidence('rec-1', ['file-1'])).rejects.toThrow('帳票を記録に紐づけられませんでした');
  });
});
