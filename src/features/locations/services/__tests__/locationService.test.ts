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
  action: 'select' | 'delete' | 'insert' | 'update';
  payload?: unknown;
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
    insert: (payload: unknown) => {
      query.action = 'insert';
      query.payload = payload;
      return builder;
    },
    update: () => {
      query.action = 'update';
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
    from: (table: string) => makeBuilder(table),
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}));

const throwIfWriteForbidden = vi.hoisted(() => vi.fn());
vi.mock('@/lib/writePermission', () => ({ throwIfWriteForbidden }));

import { addLocation, addLocations, deleteLocation, updateLocations } from '../locationService';

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
  if (query.table === 'locations') {
    return { data: query.action === 'delete' ? [{ id: 'loc-1' }] : null, error: null };
  }
  return { data: null, error: null };
};

const fetchMock = vi.fn();

beforeEach(() => {
  queryLog = [];
  resolveQuery = defaultResolver;
  throwIfWriteForbidden.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const refreshedFiscalYearIds = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).fiscalYearId);

describe('addLocations', () => {
  it('retries only a failed chunk and reports original indexes and progress', async () => {
    resolveQuery = query => {
      if (query.table === 'profiles') return { data: { organizationId: 'org-1' }, error: null };
      if (query.table === 'locations' && query.action === 'insert') {
        const payload = query.payload as { name: string } | { name: string }[];
        if (Array.isArray(payload)) {
          if (payload[0].name === 'place-100') return { error: { message: 'bad row' } };
          return { data: payload.map((row, index) => ({ ...row, id: `id-${index}` })), error: null };
        }
        if (payload.name === 'place-101') return { error: { message: 'bad row' } };
        return { data: { ...payload, id: payload.name }, error: null };
      }
      return defaultResolver(query);
    };
    const progress: number[] = [];
    const locations = Array.from({ length: 205 }, (_, index) => ({
      name: `place-${index}`, region: 'Kanto' as const, type: 'branch' as const,
      person: '', status: 'active' as const,
    }));

    const result = await addLocations(locations, count => progress.push(count));

    expect(result.created).toHaveLength(204);
    expect(result.failures).toEqual([{ index: 101, message: 'bad row' }]);
    expect(progress[0]).toBe(100);
    expect(progress.at(-1)).toBe(205);
    expect(queryLog.filter(query => query.action === 'insert' && !Array.isArray(query.payload)))
      .toHaveLength(100);
  });
});

describe('deleteLocation', () => {
  it('削除が 0 件（閲覧者は RLS で止められる）なら権限を確かめ、権限の文言で失敗させて集計は更新しない', async () => {
    resolveQuery = query =>
      query.table === 'locations' && query.action === 'delete' ? { data: [], error: null } : defaultResolver(query);
    throwIfWriteForbidden.mockRejectedValue(new Error('閲覧者は閲覧のみ可能です。編集はできません'));

    await expect(deleteLocation('loc-1')).rejects.toThrow('閲覧者は閲覧のみ可能です。編集はできません');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('削除できたときは権限を確かめない', async () => {
    await deleteLocation('loc-1');
    expect(throwIfWriteForbidden).not.toHaveBeenCalled();
  });

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

// 閲覧者の insert は RLS（42501）で失敗し、update は 0 件（PGRST116）になる。画面を開いたまま閲覧者に
// 変えられた人にも、行ごとの「失敗」ではなく権限の文言を出す。
describe('拠点の登録・CSV の一括登録と一括更新が RLS で止められたとき', () => {
  const FORBIDDEN = '閲覧者は閲覧のみ可能です。編集はできません';
  const input = { name: '本社', region: '関東', type: 'office' } as unknown as Parameters<typeof addLocation>[0];
  const rlsDenied = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };

  beforeEach(() => {
    resolveQuery = query =>
      query.table === 'profiles' ? { data: { organizationId: 'org-1' }, error: null } : rlsDenied;
    throwIfWriteForbidden.mockRejectedValue(new Error(FORBIDDEN));
  });

  it('addLocation は権限の文言で失敗する', async () => {
    await expect(addLocation(input)).rejects.toThrow(FORBIDDEN);
  });

  it('addLocations は 1 件ずつの入れ直しに進まず、権限の文言で失敗する', async () => {
    await expect(addLocations([input, input])).rejects.toThrow(FORBIDDEN);
    expect(queryLog.filter(q => q.table === 'locations' && q.action === 'insert')).toHaveLength(1);
  });

  it('updateLocations は行ごとの失敗ではなく、権限の文言で失敗する', async () => {
    resolveQuery = () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    await expect(updateLocations([{ id: 'loc-1', location: input }])).rejects.toThrow(FORBIDDEN);
  });

  it('書ける人の失敗は今までどおり（addLocation は既定の文言、一括は行ごとの失敗）', async () => {
    throwIfWriteForbidden.mockResolvedValue(undefined);
    await expect(addLocation(input)).rejects.toThrow('拠点の登録に失敗しました');
    const result = await addLocations([input]);
    expect(result.failures).toEqual([{ index: 0, message: 'new row violates row-level security policy' }]);
  });
});
