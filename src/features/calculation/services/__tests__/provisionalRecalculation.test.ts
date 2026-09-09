// 暫定適用のまま残った算定済みレコードの検出・差し戻しの回帰テスト。
//
// supabase の実DBは使わず、管理クライアントのスタブで
//   - 候補の絞り込み条件（算定済み・公式係数・applicableYear < 会計年度の終了日の温対法年度）
//   - 「対象年度の公式係数が公表済みか」による最終判定（energyType ごと）
//   - 差し戻し（isCalculated = false）の対象と件数
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

import {
  findProvisionalRecalculationTargets,
  resetProvisionalCalculatedRecords,
} from '../provisionalRecalculation';

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
    for (const name of ['select', 'eq', 'neq', 'gte', 'lte', 'lt', 'in', 'or', 'order', 'update']) {
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
    // update().eq().in() のように末尾で await されるチェーンに対応する。
    builder.then = (
      resolve: (value: QueryResult) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  };

  return { client: { from }, queries };
};

const FISCAL_YEAR = {
  id: 'fy-2026',
  label: 'FY2026',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
};

/**
 * 2026年度（4月始まり）の算定済みレコード 2 件。どちらも 2025年度係数で暫定適用して算定済み。
 * 電気だけ 2026年度の公式係数が公表され、都市ガスはまだ未公表という状況。
 */
const CANDIDATE_ROWS = [
  {
    activityRecordId: 'act-electricity',
    activity_records: { periodStart: '2026-05-01', energyType: 'electricity' },
    emission_factors: { applicableYear: 2025, isCustom: false },
  },
  {
    activityRecordId: 'act-city-gas',
    activity_records: { periodStart: '2026-05-01', energyType: 'city_gas' },
    emission_factors: { applicableYear: 2025, isCustom: false },
  },
];

const PUBLISHED_FACTOR_ROWS = [
  { energyType: 'electricity', applicableYear: 2026, isCustom: false, status: 'active' },
  { energyType: 'city_gas', applicableYear: 2025, isCustom: false, status: 'active' },
];

const respondWithRows = (rowsByTable: Record<string, unknown[]>) => (query: RecordedQuery) => ({
  data: rowsByTable[query.table] ?? [],
  error: null,
});

describe('findProvisionalRecalculationTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正式係数が公表された energyType のレコードだけを再算定対象に数える', async () => {
    const { client, queries } = createSupabaseStub(
      respondWithRows({
        fiscal_years: [FISCAL_YEAR],
        emission_results: CANDIDATE_ROWS,
        emission_factors: PUBLISHED_FACTOR_ROWS,
      }),
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(findProvisionalRecalculationTargets('org-1')).resolves.toEqual([
      { fiscalYearId: 'fy-2026', fiscalYearLabel: 'FY2026', recordCount: 1 },
    ]);

    // 候補は DB 側で「算定済み・公式係数・会計年度に含まれる最も新しい温対法年度より前の係数」に絞ってから取る。
    const candidateQuery = queries.find((query) => query.table === 'emission_results');
    expect(candidateQuery?.calls).toContainEqual(['eq', 'activity_records.isCalculated', true]);
    expect(candidateQuery?.calls).toContainEqual(['eq', 'emission_factors.isCustom', false]);
    expect(candidateQuery?.calls).toContainEqual(['lt', 'emission_factors.applicableYear', 2026]);
    expect(candidateQuery?.calls).toContainEqual(['gte', 'activity_records.periodStart', '2026-04-01']);
    expect(candidateQuery?.calls).toContainEqual(['lte', 'activity_records.periodStart', '2027-03-31']);
  });

  it('候補が無ければ公式係数を引かずに対象なしを返す', async () => {
    const { client, queries } = createSupabaseStub(
      respondWithRows({ fiscal_years: [FISCAL_YEAR], emission_results: [] }),
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(findProvisionalRecalculationTargets('org-1')).resolves.toEqual([]);
    expect(queries.some((query) => query.table === 'emission_factors')).toBe(false);
  });

  it('対象年度がまだ未公表なら再算定対象にしない', async () => {
    const { client } = createSupabaseStub(
      respondWithRows({
        fiscal_years: [FISCAL_YEAR],
        emission_results: CANDIDATE_ROWS,
        emission_factors: [
          { energyType: 'electricity', applicableYear: 2025, isCustom: false, status: 'active' },
        ],
      }),
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(findProvisionalRecalculationTargets('org-1')).resolves.toEqual([]);
  });

  it('非4月始まりの会計年度では、またいだ後の月の暫定適用も候補に含める', async () => {
    // 7月始まり FY2025（2025-07-01〜2026-06-30）の 2026-04 は温対法年度 2026。
    // 適用済みの 2025年度係数は会計年度の開始年と同じなので、開始年で絞ると候補から漏れる。
    const julyFiscalYear = {
      id: 'fy-2025-july',
      label: 'FY2025',
      startDate: '2025-07-01',
      endDate: '2026-06-30',
    };
    const { client, queries } = createSupabaseStub(
      respondWithRows({
        fiscal_years: [julyFiscalYear],
        emission_results: [
          {
            activityRecordId: 'act-crossing',
            activity_records: { periodStart: '2026-04-01', energyType: 'electricity' },
            emission_factors: { applicableYear: 2025, isCustom: false },
          },
        ],
        emission_factors: [
          { energyType: 'electricity', applicableYear: 2026, isCustom: false, status: 'active' },
        ],
      }),
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(findProvisionalRecalculationTargets('org-1')).resolves.toEqual([
      { fiscalYearId: 'fy-2025-july', fiscalYearLabel: 'FY2025', recordCount: 1 },
    ]);

    const candidateQuery = queries.find((query) => query.table === 'emission_results');
    expect(candidateQuery?.calls).toContainEqual(['lt', 'emission_factors.applicableYear', 2026]);
  });

  it('会計年度の取得に失敗したら安全なメッセージで失敗する', async () => {
    const { client } = createSupabaseStub((query) =>
      query.table === 'fiscal_years'
        ? { data: null, error: { message: 'relation … does not exist' } }
        : { data: [], error: null },
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(findProvisionalRecalculationTargets('org-1')).rejects.toThrow(
      '会計年度の取得に失敗しました',
    );
  });
});

describe('resetProvisionalCalculatedRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('対象レコードだけを isCalculated = false へ戻す', async () => {
    const { client, queries } = createSupabaseStub(
      respondWithRows({
        fiscal_years: [FISCAL_YEAR],
        emission_results: CANDIDATE_ROWS,
        emission_factors: PUBLISHED_FACTOR_ROWS,
        activity_records: [],
      }),
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(
      resetProvisionalCalculatedRecords({ organizationId: 'org-1', fiscalYearId: 'fy-2026' }),
    ).resolves.toEqual({ fiscalYearId: 'fy-2026', fiscalYearLabel: 'FY2026', resetCount: 1 });

    const updateQuery = queries.find((query) => query.table === 'activity_records');
    expect(updateQuery?.calls).toContainEqual(['update', { isCalculated: false }]);
    expect(updateQuery?.calls).toContainEqual(['eq', 'organizationId', 'org-1']);
    expect(updateQuery?.calls).toContainEqual(['in', 'id', ['act-electricity']]);
  });

  it('対象が無ければ更新を発行しない', async () => {
    const { client, queries } = createSupabaseStub(
      respondWithRows({ fiscal_years: [FISCAL_YEAR], emission_results: [] }),
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(
      resetProvisionalCalculatedRecords({ organizationId: 'org-1', fiscalYearId: 'fy-2026' }),
    ).resolves.toEqual({ fiscalYearId: 'fy-2026', fiscalYearLabel: 'FY2026', resetCount: 0 });
    expect(queries.some((query) => query.table === 'activity_records')).toBe(false);
  });

  it('自組織に無い年度は null を返す（呼び出し側が404にする）', async () => {
    const { client } = createSupabaseStub(respondWithRows({ fiscal_years: [] }));
    mocks.createAdminClient.mockReturnValue(client);

    await expect(
      resetProvisionalCalculatedRecords({ organizationId: 'org-1', fiscalYearId: 'fy-other-org' }),
    ).resolves.toBeNull();
  });

  it('UUID 形式でない年度IDは「存在しない年度」として扱う', async () => {
    const { client } = createSupabaseStub((query) =>
      query.table === 'fiscal_years'
        ? { data: null, error: { message: 'invalid input syntax for type uuid', code: '22P02' } }
        : { data: [], error: null },
    );
    mocks.createAdminClient.mockReturnValue(client);

    await expect(
      resetProvisionalCalculatedRecords({ organizationId: 'org-1', fiscalYearId: 'not-a-uuid' }),
    ).resolves.toBeNull();
  });
});
