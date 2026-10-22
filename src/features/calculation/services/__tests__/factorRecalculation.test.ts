// カスタム係数の値を変えたときの、算定済みレコードの差し戻しの回帰テスト。
//
// supabase の実DBは使わず、管理クライアントのスタブで
//   - 自組織の係数でなければ何もしない（公式係数・他組織の係数）
//   - その係数で算定済みのレコードだけを、算定年度に属するものに限って isCalculated = false へ戻す
//   - 戻したレコードの会計年度（続けて算定する年度）を返す
// を検証する。旧 emission_results の削除は DB トリガー
// （clear_emission_results_on_recalculation・supabase/migrations/20260831000000_schema.sql）が担う。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/logging/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { fiscalYearIdForPeriodStart, resetRecordsCalculatedWithFactor } from '../factorRecalculation';

interface RecordedQuery {
  table: string;
  calls: Array<[string, ...unknown[]]>;
}

interface QueryResult {
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
}

/** テーブル名ごとに応答を返す supabase クライアントのスタブ（PostgREST のチェーンだけを再現する）。 */
const createSupabaseStub = (
  respond: (query: RecordedQuery) => QueryResult,
): { client: unknown; queries: RecordedQuery[] } => {
  const queries: RecordedQuery[] = [];

  const from = (table: string) => {
    const query: RecordedQuery = { table, calls: [] };
    queries.push(query);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST のチェーンを模したスタブ
    const builder: any = {};
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        query.calls.push([name, ...args]);
        return builder;
      };
    for (const name of ['select', 'eq', 'in', 'order', 'update']) {
      builder[name] = record(name);
    }
    builder.range = (from_: number, to: number) => {
      query.calls.push(['range', from_, to]);
      return Promise.resolve(respond(query));
    };
    builder.maybeSingle = () => {
      query.calls.push(['maybeSingle']);
      const result = respond(query);
      return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
    };
    // select().eq() や update().eq().in() のように末尾で await されるチェーンに対応する。
    builder.then = (
      resolve: (value: QueryResult) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  };

  return { client: { from }, queries };
};

const FISCAL_YEARS = [
  { id: 'fy-2025', startDate: '2025-04-01', endDate: '2026-03-31' },
  { id: 'fy-2026', startDate: '2026-04-01', endDate: '2027-03-31' },
];

/** この係数で算定済みのレコード 3 件。1 件は算定年度が登録されていない期間（2024年度）。 */
const CALCULATED_ROWS = [
  { activityRecordId: 'act-2025', activity_records: { periodStart: '2025-06-01' } },
  { activityRecordId: 'act-2026', activity_records: { periodStart: '2026-05-01' } },
  { activityRecordId: 'act-2024', activity_records: { periodStart: '2024-07-01' } },
];

const respondWithRows = (rowsByTable: Record<string, unknown[]>) => (query: RecordedQuery) => ({
  data: rowsByTable[query.table] ?? [],
  error: null,
});

describe('fiscalYearIdForPeriodStart', () => {
  it('periodStart を含む会計年度を返し、どの年度にも属さなければ null', () => {
    expect(fiscalYearIdForPeriodStart(FISCAL_YEARS, '2026-03-31')).toBe('fy-2025');
    expect(fiscalYearIdForPeriodStart(FISCAL_YEARS, '2026-04-01')).toBe('fy-2026');
    expect(fiscalYearIdForPeriodStart(FISCAL_YEARS, '2024-07-01')).toBeNull();
  });
});

describe('resetRecordsCalculatedWithFactor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('その係数で算定済みのレコードのうち、算定年度に属するものだけを差し戻す', async () => {
    const { client, queries } = createSupabaseStub(
      respondWithRows({
        emission_factors: [{ id: 'factor-1' }],
        emission_results: CALCULATED_ROWS,
        fiscal_years: FISCAL_YEARS,
      }),
    );
    mocks.createAdminClient.mockReturnValue(client);

    const result = await resetRecordsCalculatedWithFactor({ organizationId: 'org-1', factorId: 'factor-1' });

    expect(result).toEqual({ resetCount: 2, skippedCount: 1, fiscalYearIds: ['fy-2025', 'fy-2026'] });

    // 係数の所有確認は自組織に限る（公式係数・他組織の係数は対象外）
    const factorQuery = queries.find((query) => query.table === 'emission_factors')!;
    expect(factorQuery.calls).toContainEqual(['eq', 'organizationId', 'org-1']);
    expect(factorQuery.calls).toContainEqual(['eq', 'id', 'factor-1']);

    // 算定済みの結果は「この係数を適用したもの」に絞る
    const resultQuery = queries.find((query) => query.table === 'emission_results')!;
    expect(resultQuery.calls).toContainEqual(['eq', 'emissionFactorId', 'factor-1']);
    expect(resultQuery.calls).toContainEqual(['eq', 'organizationId', 'org-1']);

    // 差し戻しは年度に属するレコードだけ（年度の無いレコードは旧結果を消さない）
    const updateQuery = queries.find((query) => query.table === 'activity_records')!;
    expect(updateQuery.calls).toContainEqual(['update', { isCalculated: false }]);
    expect(updateQuery.calls).toContainEqual(['eq', 'organizationId', 'org-1']);
    expect(updateQuery.calls).toContainEqual(['in', 'id', ['act-2025', 'act-2026']]);
  });

  it('自組織の係数でなければ null を返し、何も書き換えない', async () => {
    const { client, queries } = createSupabaseStub(respondWithRows({ emission_factors: [] }));
    mocks.createAdminClient.mockReturnValue(client);

    const result = await resetRecordsCalculatedWithFactor({ organizationId: 'org-1', factorId: 'official' });

    expect(result).toBeNull();
    expect(queries.some((query) => query.table === 'activity_records')).toBe(false);
  });

  it('UUID 形式でない係数IDは存在しない係数として null を返す', async () => {
    const { client } = createSupabaseStub(() => ({
      data: null,
      error: { message: 'invalid input syntax for type uuid', code: '22P02' },
    }));
    mocks.createAdminClient.mockReturnValue(client);

    await expect(
      resetRecordsCalculatedWithFactor({ organizationId: 'org-1', factorId: 'not-a-uuid' }),
    ).resolves.toBeNull();
  });

  it('算定済みのレコードが無ければ何も書き換えずに 0 件を返す', async () => {
    const { client, queries } = createSupabaseStub(
      respondWithRows({ emission_factors: [{ id: 'factor-1' }], emission_results: [] }),
    );
    mocks.createAdminClient.mockReturnValue(client);

    const result = await resetRecordsCalculatedWithFactor({ organizationId: 'org-1', factorId: 'factor-1' });

    expect(result).toEqual({ resetCount: 0, skippedCount: 0, fiscalYearIds: [] });
    expect(queries.some((query) => query.table === 'activity_records')).toBe(false);
  });

  it('差し戻しに失敗したら DB の詳細を含まないメッセージで失敗させる', async () => {
    const { client } = createSupabaseStub((query) =>
      query.table === 'activity_records'
        ? { data: null, error: { message: 'permission denied for table activity_records' } }
        : respondWithRows({
            emission_factors: [{ id: 'factor-1' }],
            emission_results: CALCULATED_ROWS,
            fiscal_years: FISCAL_YEARS,
          })(query),
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(
      resetRecordsCalculatedWithFactor({ organizationId: 'org-1', factorId: 'factor-1' }),
    ).rejects.toThrow('再算定対象への差し戻しに失敗しました');
  });
});
