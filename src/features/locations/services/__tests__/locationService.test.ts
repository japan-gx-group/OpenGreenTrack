// deleteLocation の回帰テスト。
// emission_results は locations を on delete cascade で参照するため拠点削除で算定結果は消えるが、
// dashboard_aggregates（KPI・レポート・削減目標の正本）は自動では更新されない。
// 削除前に対象年度を控え、削除後に /api/dashboard-aggregates/refresh を年度ごとに呼ぶこと、
// 再計算の失敗は削除を取り消さず警告として返すことを保証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = { data?: unknown; count?: number | null; error: { message: string } | null };

// テーブル名と適用した絞り込みから結果を返す簡易ビルダー。
// チェーン（select → eq / gte / lte / order / limit → maybeSingle / await）を thenable で解決する。
type QueryLog = {
  table: string;
  action: 'select' | 'delete';
  filters: { op: string; column: string; value: unknown }[];
  head: boolean;
};
let queryLog: QueryLog[] = [];
let resolveQuery: (query: QueryLog) => QueryResult = () => ({ data: null, error: null });

const makeBuilder = (table: string) => {
  const query: QueryLog = { table, action: 'select', filters: [], head: false };
  const builder = {
    select: (_columns: string, options?: { head?: boolean }) => {
      query.head = options?.head ?? false;
      return builder;
    },
    delete: () => {
      query.action = 'delete';
      return builder;
    },
    eq: (column: string, value: unknown) => {
      query.filters.push({ op: 'eq', column, value });
      return builder;
    },
    gte: (column: string, value: unknown) => {
      query.filters.push({ op: 'gte', column, value });
      return builder;
    },
    lte: (column: string, value: unknown) => {
      query.filters.push({ op: 'lte', column, value });
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
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
  createClient: () => ({ from: (table: string) => makeBuilder(table) }),
}));

import { deleteLocation } from '../locationService';

const fiscalYears = [
  { id: 'fy-2024', startDate: '2024-04-01', endDate: '2025-03-31' },
  { id: 'fy-2025', startDate: '2025-04-01', endDate: '2026-03-31' },
];

// 「fy-2024 にだけ算定結果がある拠点」を表す既定の応答
const defaultResolver = (query: QueryLog): QueryResult => {
  if (query.table === 'activity_records') {
    const uncalculated = query.filters.some(f => f.column === 'isCalculated');
    const scope3 = query.filters.some(f => f.column === 'energyType');
    if (query.head) return { count: uncalculated || scope3 ? 0 : 12, error: null };
    return { data: { periodStart: '2024-04-01', periodEnd: '2025-03-31' }, error: null };
  }
  if (query.table === 'emission_results') {
    const from = query.filters.find(f => f.op === 'gte')?.value;
    if (from === undefined) return { count: 12, error: null };
    return { count: from === '2024-04-01' ? 12 : 0, error: null };
  }
  if (query.table === 'fiscal_years') return { data: fiscalYears, error: null };
  if (query.table === 'locations') return { data: null, error: null };
  return { data: null, error: null };
};

const fetchMock = vi.fn();

beforeEach(() => {
  queryLog = [];
  resolveQuery = defaultResolver;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const refreshedFiscalYearIds = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).fiscalYearId);

describe('deleteLocation', () => {
  it('算定結果がある年度だけ、削除後に集計の再計算を呼ぶ', async () => {
    const result = await deleteLocation('loc-1');

    expect(result.warning).toBeNull();
    expect(result.refreshedFiscalYearIds).toEqual(['fy-2024']);
    expect(refreshedFiscalYearIds()).toEqual(['fy-2024']);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/dashboard-aggregates/refresh');

    // 年度の特定（emission_results の head count）は削除より前に走る（削除後は行が無く特定できない）
    const deleteIndex = queryLog.findIndex(q => q.table === 'locations' && q.action === 'delete');
    const lastYearProbe = queryLog.map((q, i) => (q.table === 'emission_results' && q.head ? i : -1))
      .filter(i => i >= 0)
      .pop();
    expect(deleteIndex).toBeGreaterThan(lastYearProbe ?? -1);
    expect(queryLog[deleteIndex].filters).toEqual([{ op: 'eq', column: 'id', value: 'loc-1' }]);
  });

  it('算定結果が無い拠点は年度の特定も再計算もしない', async () => {
    resolveQuery = query => {
      if (query.table === 'emission_results') return { count: 0, error: null };
      return defaultResolver(query);
    };

    const result = await deleteLocation('loc-1');

    expect(result).toEqual({ refreshedFiscalYearIds: [], warning: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryLog.some(q => q.table === 'fiscal_years')).toBe(false);
  });

  it('再計算に失敗しても削除は成立し、警告として返す', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'boom' }) });

    const result = await deleteLocation('loc-1');

    expect(queryLog.some(q => q.table === 'locations' && q.action === 'delete')).toBe(true);
    expect(result.refreshedFiscalYearIds).toEqual([]);
    expect(result.warning).toContain('1年度分');
  });

  it('未算定の活動量データが残る拠点は削除せず、再計算も呼ばない', async () => {
    resolveQuery = query => {
      if (query.table === 'activity_records' && query.filters.some(f => f.column === 'isCalculated')) {
        return { count: 1, error: null };
      }
      return defaultResolver(query);
    };

    await expect(deleteLocation('loc-1')).rejects.toThrow('未処理の入力データがあるため削除できません');
    expect(queryLog.some(q => q.action === 'delete')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('削除自体が失敗したら例外にし、再計算は呼ばない', async () => {
    resolveQuery = query => {
      if (query.table === 'locations') return { data: null, error: { message: 'denied' } };
      return defaultResolver(query);
    };

    await expect(deleteLocation('loc-1')).rejects.toThrow('拠点の削除に失敗しました');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
