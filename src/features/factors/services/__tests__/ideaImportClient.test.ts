// fetchIdeaImportOverview の回帰テスト。
// 「直近N件から rows.find(isActive)」で active を探すと、失敗履歴が N 件を超えて蓄積したときに
// active 行がウィンドウ外へ落ち、取込済みなのに未取込表示になる。
// active は専用クエリ（isActive = true）で取得することを保証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchIdeaImportOverview, type IdeaImportRecord } from '../ideaImportClient';

// テーブル行の擬似DB。クエリビルダーのチェーン（select → eq / order / limit → maybeSingle）
// を実際に評価して返すことで、実装のクエリ形が変わっても意図（active を取りこぼさない）
// を検証できるようにする。
let dbRows: IdeaImportRecord[] = [];
let failNextQuery = false;

const makeBuilder = () => {
  const state = {
    eqFilters: [] as Array<{ column: string; value: unknown }>,
    orderColumn: null as string | null,
    ascending: true,
    limitCount: null as number | null,
  };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      state.eqFilters.push({ column, value });
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      state.orderColumn = column;
      state.ascending = options?.ascending ?? true;
      return builder;
    },
    limit: (count: number) => {
      state.limitCount = count;
      return builder;
    },
    maybeSingle: async () => {
      if (failNextQuery) return { data: null, error: { message: 'boom' } };
      let rows = dbRows.filter((row) =>
        state.eqFilters.every(
          ({ column, value }) => (row as unknown as Record<string, unknown>)[column] === value,
        ),
      );
      if (state.orderColumn) {
        const column = state.orderColumn;
        rows = [...rows].sort((a, b) => {
          const av = String((a as unknown as Record<string, unknown>)[column]);
          const bv = String((b as unknown as Record<string, unknown>)[column]);
          return state.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (state.limitCount !== null) rows = rows.slice(0, state.limitCount);
      return { data: rows[0] ?? null, error: null };
    },
  };
  return builder;
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: () => makeBuilder() }),
}));

const makeRecord = (overrides: Partial<IdeaImportRecord>): IdeaImportRecord => ({
  id: 'import-1',
  version: 'IDEA v3.4',
  releaseDate: '2026-01-01',
  gwpModel: 'GWP100 (IPCC AR6)',
  citationText: 'IDEA v3.4, AIST/SuMPO',
  fileName: 'idea.xlsx',
  status: 'completed',
  rowCount: 4321,
  isActive: false,
  unmappedRecordCount: 0,
  skippedRowCount: 0,
  errorMessage: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('fetchIdeaImportOverview', () => {
  beforeEach(() => {
    dbRows = [];
    failNextQuery = false;
  });

  it('active 行より新しい失敗履歴が10件を超えても active を返す（回帰）', async () => {
    const activeRow = makeRecord({ id: 'active-1', isActive: true });
    // active より新しい failed 行を12件積む（LIME3 版ファイルのリトライを想定）
    const failedRows = Array.from({ length: 12 }, (_, i) =>
      makeRecord({
        id: `failed-${i}`,
        status: 'failed',
        errorMessage: 'GWP列が見つかりません',
        createdAt: `2026-08-05T00:00:${String(10 + i).padStart(2, '0')}.000Z`,
      }),
    );
    dbRows = [activeRow, ...failedRows];

    const overview = await fetchIdeaImportOverview();
    expect(overview.active?.id).toBe('active-1');
    // latest は最新の失敗行（失敗理由の表示用）
    expect(overview.latest?.id).toBe('failed-11');
    expect(overview.latest?.status).toBe('failed');
  });

  it('未取込（0件）なら active / latest とも null', async () => {
    const overview = await fetchIdeaImportOverview();
    expect(overview.active).toBeNull();
    expect(overview.latest).toBeNull();
  });

  it('クエリ失敗時は日本語メッセージで throw する', async () => {
    failNextQuery = true;
    await expect(fetchIdeaImportOverview()).rejects.toThrow(
      'IDEAデータベースの取込状況の取得に失敗しました',
    );
  });
});
