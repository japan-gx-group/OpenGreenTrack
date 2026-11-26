// deleteLocation の回帰テスト。
// emission_results は locations を on delete cascade で参照するため拠点削除で算定結果は消えるが、
// dashboard_aggregates（KPI・レポート・削減目標の正本）は自動では更新されない。
// 削除前に対象年度を控え、削除後に /api/dashboard-aggregates/refresh を年度ごとに呼ぶこと、
// 再計算の失敗は削除を取り消さず警告として返すことを保証する。
// あわせて、CSVインポートの一括登録・更新（addLocations / updateLocations）が、
// 行ごとの失敗理由を PostgREST の英語メッセージのままではなく日本語で返すことを保証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = {
  data?: unknown;
  count?: number | null;
  error: { message: string; code?: string } | null;
  /** HTTP ステータス（supabase-js の応答と同じ。通信断は 0） */
  status?: number;
};

// テーブル名と適用した絞り込みから結果を返す簡易ビルダー。
// チェーン（select → eq / gte / lte / order / limit → maybeSingle / await）を thenable で解決する。
type QueryLog = {
  table: string;
  action: 'select' | 'delete' | 'update' | 'insert';
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
    update: () => {
      query.action = 'update';
      return builder;
    },
    insert: (payload: unknown) => {
      query.action = 'insert';
      query.payload = payload;
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

import { addLocations, deleteLocation, updateLocations } from '../locationService';

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
    expect(result.failures).toEqual([
      { index: 101, message: '拠点の登録に失敗しました（詳細: bad row）' },
    ]);
    expect(progress[0]).toBe(100);
    expect(progress.at(-1)).toBe(205);
    expect(queryLog.filter(query => query.action === 'insert' && !Array.isArray(query.payload)))
      .toHaveLength(100);
  });

  it('一括登録が失敗し1件ずつ入れ直しても失敗したとき、登録失敗として詳細つきの日本語で返す', async () => {
    resolveQuery = query => {
      if (query.table === 'profiles') return { data: { organizationId: 'org-1' }, error: null };
      // 一括 insert（配列）は1行でも弾かれると全体が失敗する。続く1件ずつの insert も失敗させる。
      if (Array.isArray(query.payload)) return { data: null, error: { code: '08006', message: 'bulk failed' } };
      return { data: null, error: { code: '08006', message: 'connection failure' } };
    };

    const result = await addLocations([osakaFactory]);

    expect(result.failures).toEqual([
      { index: 0, message: '拠点の登録に失敗しました（詳細: connection failure）' },
    ]);
  });
});

// リクエスト全体が原因の失敗（ログイン切れ・RLS・レート制限・タイムアウト・ゲートウェイ障害）では、1件ずつ書き直しても
// 全行が同じ理由で失敗する。書き直しを止め、行エラーを行数分並べずに stopped の1件で返すことを保証する。
const places = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `place-${index}`, region: 'Kanto' as const, type: 'branch' as const,
    person: '', status: 'active' as const,
  }));
const sessionExpired = 'ログイン情報が確認できませんでした。再度ログインしてから取り込み直してください';
const jwtExpired: QueryResult = { data: null, status: 401, error: { code: 'PGRST301', message: 'JWT expired' } };

describe('addLocations: リクエスト全体が原因の失敗', () => {
  const singleInserts = () =>
    queryLog.filter(query => query.action === 'insert' && !Array.isArray(query.payload));

  // insert の応答を差し替える。profiles（組織IDの解決）は常に成功させる。
  const resolveInserts = (onInsert: (payload: { name: string } | { name: string }[]) => QueryResult) => {
    resolveQuery = query => {
      if (query.table === 'profiles') return { data: { organizationId: 'org-1' }, error: null };
      if (query.table === 'locations' && query.action === 'insert') {
        return onInsert(query.payload as { name: string } | { name: string }[]);
      }
      return defaultResolver(query);
    };
  };
  const succeed = (payload: { name: string } | { name: string }[]): QueryResult =>
    Array.isArray(payload)
      ? { data: payload.map(row => ({ ...row, id: row.name })), error: null, status: 201 }
      : { data: { ...payload, id: payload.name }, error: null, status: 201 };

  it('セッション切れ（401）では1件ずつ入れ直さず、残りのチャンクも送らない', async () => {
    resolveInserts(() => jwtExpired);

    const result = await addLocations(places(1000));

    expect(result).toEqual({
      created: [], failures: [], stopped: { reason: sessionExpired, unconfirmedCount: 0 },
    });
    expect(queryLog.filter(query => query.action === 'insert')).toHaveLength(1);
  });

  it('code の無い 401（ゲートウェイが返す場合など）も、ログインし直すよう案内する', async () => {
    resolveInserts(() => ({ data: null, status: 401, error: { code: '', message: 'Invalid JWT' } }));

    const result = await addLocations(places(300));

    expect(result.stopped).toEqual({ reason: sessionExpired, unconfirmedCount: 0 });
    expect(singleInserts()).toHaveLength(0);
  });

  it('RLS による拒否（403 / 42501）でも入れ直さない', async () => {
    resolveInserts(() => ({ data: null, status: 403, error: { code: '42501', message: 'new row violates row-level security policy' } }));

    const result = await addLocations(places(300));

    expect(result.failures).toEqual([]);
    expect(result.stopped).toEqual({ reason: sessionExpired, unconfirmedCount: 0 });
    expect(singleInserts()).toHaveLength(0);
  });

  it('レート制限（429）では入れ直さず、待ってから取り込み直すよう案内する', async () => {
    resolveInserts(() => ({ data: null, status: 429, error: { code: '', message: 'Too Many Requests' } }));

    const result = await addLocations(places(300));

    expect(result.failures).toEqual([]);
    expect(result.stopped).toEqual({
      reason: 'アクセスが集中しているため取込を中止しました。しばらく待ってから取り込み直してください',
      unconfirmedCount: 0,
    });
    expect(singleInserts()).toHaveLength(0);
  });

  it('ステートメントタイムアウト（57014）ではロールバック済みなので、確認できない行としては数えない', async () => {
    resolveInserts(() => ({ data: null, status: 500, error: { code: '57014', message: 'canceling statement due to statement timeout' } }));

    const result = await addLocations(places(300));

    expect(result.failures).toEqual([]);
    expect(result.stopped).toEqual({
      reason: '拠点の登録に失敗しました（詳細: canceling statement due to statement timeout）',
      unconfirmedCount: 0,
    });
    expect(singleInserts()).toHaveLength(0);
  });

  it('DB に接続できない（503）ときも入れ直さない', async () => {
    resolveInserts(() => ({ data: null, status: 503, error: { code: 'PGRST001', message: 'Database client error' } }));

    const result = await addLocations(places(300));

    expect(result.stopped?.unconfirmedCount).toBe(0);
    expect(singleInserts()).toHaveLength(0);
  });

  it.each([
    ['通信断（status 0）', { data: null, status: 0, error: { code: '', message: 'FetchError: Failed to fetch' } }],
    ['ゲートウェイの障害（502）', { data: null, status: 502, error: { code: '', message: 'Bad Gateway' } }],
    ['ゲートウェイのタイムアウト（504）', { data: null, status: 504, error: { code: '', message: 'Gateway Timeout' } }],
    ['code の無い 500', { data: null, status: 500, error: { code: '', message: 'Internal Server Error' } }],
    ['プロキシのタイムアウト（524）', { data: null, status: 524, error: { code: '', message: 'A Timeout Occurred' } }],
  ] as [string, QueryResult][])('%sでは入れ直さず、応答が届かなかったチャンクの行を「確認できない」として返す', async (_label, response) => {
    resolveInserts(payload => (Array.isArray(payload) && payload[0].name === 'place-100' ? response : succeed(payload)));

    const result = await addLocations(places(300));

    expect(result.created).toHaveLength(100);
    expect(result.failures).toEqual([]);
    // fetch やゲートウェイの英語の文面は出さない
    expect(result.stopped).toEqual({
      reason: 'サーバーとの通信に失敗したため取込を中止しました。通信環境を確かめてから取り込み直してください',
      unconfirmedCount: 100,
    });
    expect(singleInserts()).toHaveLength(0);
    expect(queryLog.filter(query => query.action === 'insert')).toHaveLength(2);
  });

  it('スキーマが合わない（PGRST204）ときは、どの行でも同じく失敗するので入れ直さない', async () => {
    resolveInserts(() => ({ data: null, status: 400, error: { code: 'PGRST204', message: "Could not find the 'name' column" } }));

    const result = await addLocations(places(1000));

    expect(result.failures).toEqual([]);
    expect(result.stopped?.reason).toBe("拠点の登録に失敗しました（詳細: Could not find the 'name' column）");
    expect(singleInserts()).toHaveLength(0);
  });

  it('入れ直しの途中でセッションが切れたら止め、行そのものが原因の失敗は行エラーとして残す', async () => {
    const badRow: QueryResult = { data: null, status: 400, error: { code: 'P0001', message: 'bad row' } };
    resolveInserts(payload => {
      if (Array.isArray(payload)) return badRow;
      const position = Number(payload.name.replace('place-', ''));
      // place-1 と、セッションが切れるバッチ（place-5 〜 place-9）の中の place-6 は行そのものが原因で失敗する
      if (position === 1 || position === 6) return badRow;
      if (position >= 7) return jwtExpired;
      return succeed(payload);
    });
    const progress: number[] = [];

    const result = await addLocations(places(100), count => progress.push(count));

    expect(result.failures).toEqual([
      { index: 1, message: '拠点の登録に失敗しました（詳細: bad row）' },
      { index: 6, message: '拠点の登録に失敗しました（詳細: bad row）' },
    ]);
    expect(result.created.map(record => record.name)).toEqual(['place-0', 'place-2', 'place-3', 'place-4', 'place-5']);
    expect(result.stopped).toEqual({ reason: sessionExpired, unconfirmedCount: 0 });
    expect(singleInserts()).toHaveLength(10);
    // 止めたバッチまでの進捗を返す（止まった時点の件数で表示が止まらないように）
    expect(progress.at(-1)).toBe(10);
  });

  it('分類にないコード（P0001 など）は行が原因の可能性があるので、同じコードが続いても止めずに行エラーとして返す', async () => {
    resolveInserts(() => ({ data: null, status: 400, error: { code: 'P0001', message: 'bad row' } }));

    const result = await addLocations(places(100));

    expect(result.stopped).toBeNull();
    expect(result.failures).toHaveLength(100);
    expect(singleInserts()).toHaveLength(100);
  });
});

describe('updateLocations: リクエスト全体が原因の失敗', () => {
  const updates = (count: number) =>
    places(count).map((location, index) => ({ id: `loc-${index}`, location }));
  const updateQueries = () => queryLog.filter(query => query.action === 'update');
  const targetId = (query: QueryLog) => query.filters.find(filter => filter.column === 'id')?.value as string;

  it('途中でセッションが切れたら残りを送らず、行エラーを並べずに止めた理由1件で返す', async () => {
    resolveQuery = query => {
      if (query.action !== 'update') return defaultResolver(query);
      const position = Number(targetId(query).replace('loc-', ''));
      return position < 5 ? { data: { id: targetId(query) }, error: null, status: 200 } : jwtExpired;
    };

    const result = await updateLocations(updates(1000));

    expect(result.updated).toHaveLength(5);
    expect(result.failures).toEqual([]);
    expect(result.stopped).toEqual({ reason: sessionExpired, unconfirmedCount: 0 });
    expect(updateQueries()).toHaveLength(10);
  });

  it('対象が削除されていた（PGRST116 / 406）のは行が原因なので、止めずに行エラーとして返す', async () => {
    resolveQuery = query =>
      query.action === 'update'
        ? { data: null, status: 406, error: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' } }
        : defaultResolver(query);

    const result = await updateLocations(updates(10));

    expect(result.stopped).toBeNull();
    expect(result.failures).toHaveLength(10);
    expect(updateQueries()).toHaveLength(10);
  });
});

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

// CSVインポートの一括更新は、失敗した行の理由を取込画面の行エラー欄へそのまま出す。
// PostgREST の英語メッセージを素通しせず、日本語に変換して返すことを保証する。
const osakaFactory = {
  name: '大阪工場',
  region: 'Kansai',
  type: 'factory',
  person: '',
  status: 'active',
} as const;

describe('updateLocations', () => {
  it('プレビュー後に対象が削除され0件マッチになったとき、行エラーを日本語で返す', async () => {
    resolveQuery = () => ({
      data: null,
      error: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' },
    });

    const result = await updateLocations([{ id: 'loc-deleted', location: osakaFactory }]);

    expect(result.failures).toEqual([
      {
        index: 0,
        message:
          '更新対象の拠点が見つかりません。取込の確認後に削除された可能性があります。一覧を再読み込みし、プレビューを確認してから取り込み直してください',
      },
    ]);
  });
});
