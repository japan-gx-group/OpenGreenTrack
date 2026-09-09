// getActiveScope12Factors の回帰テスト。
// 年度あたりの標準係数が max_rows（1000）を超えると、サーバ側の算定は正しく解決するのに
// インライン候補・自動選択のプレビューだけが静かに欠ける。range() でページングして全行返すことを保証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE } from '@/lib/supabaseRows';

type QueryResult = { data: unknown; error: { message: string } | null };

type QueryLog = {
  table: string;
  filters: { op: string; column: string; value: unknown }[];
  range: [number, number] | null;
};
let queryLog: QueryLog[] = [];
let resolveQuery: (query: QueryLog) => QueryResult = () => ({ data: null, error: null });

const makeBuilder = (table: string) => {
  const query: QueryLog = { table, filters: [], range: null };
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
    is: (column: string, value: unknown) => {
      query.filters.push({ op: 'is', column, value });
      return builder;
    },
    not: (column: string, op: string, value: unknown) => {
      query.filters.push({ op: `not.${op}`, column, value });
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      query.range = [from, to];
      return builder;
    },
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) => {
      queryLog.push(query);
      return Promise.resolve(resolveQuery(query)).then(onFulfilled, onRejected);
    },
  };
  return builder;
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { getActiveScope12Factors } from '../factorSelectionService';

const makeFactorRow = (index: number) => ({
  id: `factor-${String(index).padStart(5, '0')}`,
  organizationId: null,
  name: `係数${index}`,
  energyType: 'electricity',
  scope: 'scope2',
  factorValue: '0.000453',
  unit: 'kWh',
  applicableYear: 2025,
  regionName: null,
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: null,
  effectiveTo: null,
  providerName: null,
  providerNumber: null,
  menuName: null,
  factorType: null,
  source: 'moe',
  sourceDocumentName: null,
});

const makeResolver = (totalRows: number) => (query: QueryLog): QueryResult => {
  const [from, to] = query.range ?? [0, PAGE_SIZE - 1];
  const rows = [];
  for (let i = from; i <= Math.min(to, totalRows - 1); i++) {
    rows.push(makeFactorRow(i));
  }
  return { data: rows, error: null };
};

beforeEach(() => {
  queryLog = [];
});

describe('getActiveScope12Factors', () => {
  it('max_rows（1000）を超える標準係数もページングして全件返す', async () => {
    const total = PAGE_SIZE + 3;
    resolveQuery = makeResolver(total);

    const factors = await getActiveScope12Factors([2025]);

    expect(factors).toHaveLength(total);
    // numeric 文字列は number に正規化される
    expect(factors[0].factorValue).toBe(0.000453);
    expect(queryLog.map((q) => q.range)).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ]);
  });

  it('算定バッチと同じ絞り込み（active・適用年度・事業者別除外）を各ページに適用する', async () => {
    resolveQuery = makeResolver(2);

    await getActiveScope12Factors([2024, 2025]);

    expect(queryLog[0].filters).toEqual([
      { op: 'eq', column: 'status', value: 'active' },
      { op: 'in', column: 'applicableYear', value: [2024, 2025] },
      { op: 'is', column: 'providerName', value: null },
    ]);
  });

  it('適用年度が空なら問い合わせずに空配列を返す', async () => {
    resolveQuery = makeResolver(5);

    await expect(getActiveScope12Factors([])).resolves.toEqual([]);
    expect(queryLog).toHaveLength(0);
  });

  it('取得に失敗した場合は係数用のメッセージで throw する', async () => {
    resolveQuery = () => ({ data: null, error: { message: 'db error' } });

    await expect(getActiveScope12Factors([2025])).rejects.toThrow('排出係数の取得に失敗しました');
  });
});
