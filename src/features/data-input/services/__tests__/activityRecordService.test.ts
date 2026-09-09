// getActivityHistoryRecords の回帰テスト。
// PostgREST の max_rows（1000）で黙って切り詰められると 1001 件目以降の古いレコードが履歴から消え、
// 編集・削除のどこからも到達できなくなる。range() でページングして全行を返すことを保証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE } from '@/lib/supabaseRows';

type QueryResult = { data: unknown; error: { message: string } | null };

type QueryLog = {
  table: string;
  filters: { op: string; column: string; value: unknown }[];
  orders: { column: string; ascending: boolean }[];
  range: [number, number] | null;
};
let queryLog: QueryLog[] = [];
let resolveQuery: (query: QueryLog) => QueryResult = () => ({ data: null, error: null });

// select → eq / in → order → range → await（thenable）のチェーンを記録して結果を返す簡易ビルダー。
const makeBuilder = (table: string) => {
  const query: QueryLog = { table, filters: [], orders: [], range: null };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      query.filters.push({ op: 'eq', column, value });
      return builder;
    },
    in: (column: string, value: unknown) => {
      query.filters.push({ op: 'in', column, value });
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      query.orders.push({ column, ascending: options?.ascending ?? true });
      return builder;
    },
    range: (from: number, to: number) => {
      query.range = [from, to];
      return builder;
    },
    single: async () => {
      queryLog.push(query);
      return resolveQuery(query);
    },
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) => {
      queryLog.push(query);
      return Promise.resolve(resolveQuery(query)).then(onFulfilled, onRejected);
    },
  };
  return builder;
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => makeBuilder(table),
  }),
}));

import { getActivityHistoryRecords } from '../activityRecordService';

const makeRecordRow = (index: number) => ({
  id: `rec-${String(index).padStart(5, '0')}`,
  locationId: 'loc-1',
  energyType: 'electricity',
  amount: '10',
  unit: 'kWh',
  periodStart: '2025-04-01',
  periodEnd: '2025-04-30',
  note: null,
  emissionFactorId: null,
  scope3CategoryId: null,
  ideaFactorId: null,
  createdAt: '2025-05-01T00:00:00Z',
  locations: { id: 'loc-1', name: '本社' },
  idea_factors: null,
});

// activity_records を totalRows 件持つ組織を模した応答
const makeResolver = (totalRows: number) => (query: QueryLog): QueryResult => {
  if (query.table === 'profiles') {
    return { data: { organizationId: 'org-1' }, error: null };
  }
  if (query.table === 'activity_records') {
    const [from, to] = query.range ?? [0, PAGE_SIZE - 1];
    const rows = [];
    for (let i = from; i <= Math.min(to, totalRows - 1); i++) {
      rows.push(makeRecordRow(i));
    }
    return { data: rows, error: null };
  }
  if (query.table === 'emission_results') {
    return { data: [], error: null };
  }
  return { data: null, error: null };
};

beforeEach(() => {
  queryLog = [];
});

describe('getActivityHistoryRecords', () => {
  it('max_rows（1000）を超えるレコードもページングして全件返す', async () => {
    const total = PAGE_SIZE + 5;
    resolveQuery = makeResolver(total);

    const records = await getActivityHistoryRecords();

    expect(records).toHaveLength(total);
    // 最古（ページ末尾）のレコードも落ちていない
    expect(records[total - 1].id).toBe(`rec-${String(total - 1).padStart(5, '0')}`);

    const historyQueries = queryLog.filter((q) => q.table === 'activity_records');
    expect(historyQueries.map((q) => q.range)).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ]);
  });

  it('ページ境界で重複・欠落しないよう createdAt の後に id で並び順を固定する', async () => {
    resolveQuery = makeResolver(3);

    await getActivityHistoryRecords();

    const historyQuery = queryLog.find((q) => q.table === 'activity_records');
    expect(historyQuery?.orders).toEqual([
      { column: 'createdAt', ascending: false },
      { column: 'id', ascending: true },
    ]);
    expect(historyQuery?.filters).toContainEqual({ op: 'eq', column: 'organizationId', value: 'org-1' });
  });

  it('取得に失敗した場合は履歴用のメッセージで throw する', async () => {
    resolveQuery = (query) =>
      query.table === 'activity_records'
        ? { data: null, error: { message: 'db error' } }
        : makeResolver(0)(query);

    await expect(getActivityHistoryRecords()).rejects.toThrow('入力履歴の取得に失敗しました');
  });
});
