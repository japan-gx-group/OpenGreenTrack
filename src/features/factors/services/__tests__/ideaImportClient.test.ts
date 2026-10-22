// ideaImportClient のテスト。
// - fetchIdeaImportOverview の回帰: 「直近N件から rows.find(isActive)」で active を探すと、失敗履歴が
//   N 件を超えて蓄積したときに active 行がウィンドウ外へ落ち、取込済みなのに未取込表示になる。
//   active は専用クエリ（isActive = true）で取得することを保証する。
// - startIdeaImport: 署名付き URL 発行 → Storage へ直接アップロード → パスだけを取込 API へ渡す
//   3 段階の経路（ファイル本体を API に送らない）を検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIdeaImportOverview,
  requestStaleIdeaImportRecovery,
  startIdeaImport,
  type IdeaImportRecord,
  type IdeaImportStartPhase,
} from '../ideaImportClient';

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

// Storage への直接アップロード（uploadToSignedUrl）の呼び出し記録
const storageCalls: { bucket: string; path: string; token: string; file: File; options: unknown }[] = [];
let storageUploadError: { message: string } | null = null;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => makeBuilder(),
    storage: {
      from: (bucket: string) => ({
        uploadToSignedUrl: async (path: string, token: string, file: File, options: unknown) => {
          storageCalls.push({ bucket, path, token, file, options });
          return storageUploadError ? { data: null, error: storageUploadError } : { data: { path }, error: null };
        },
      }),
    },
  }),
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

describe('startIdeaImport', () => {
  const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'IDEA_dummy.xlsx');
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    storageCalls.length = 0;
    storageUploadError = null;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('署名付き URL を発行 → Storage へ直接アップロード → パスだけを取込 API へ渡す', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { bucket: 'upload-quarantine', storagePath: 'org-1/idea-imports/u-1.xlsx', token: 'tok' }),
      )
      .mockResolvedValueOnce(jsonResponse(202, { importId: 'import-1' }));
    const phases: IdeaImportStartPhase[] = [];

    const result = await startIdeaImport(file, 'IPCC 2021 GWP 100a without LULUCF', true, (phase) => phases.push(phase));

    expect(result).toEqual({ importId: 'import-1' });
    expect(phases).toEqual(['uploading', 'starting']);

    // ① 発行 API にはファイル名とサイズだけを申告する
    const [urlInput, urlInit] = fetchMock.mock.calls[0];
    expect(urlInput).toBe('/api/idea-imports/upload-url');
    expect(JSON.parse(String(urlInit?.body))).toEqual({ fileName: 'IDEA_dummy.xlsx', fileSize: 4 });

    // ② 発行されたバケット・パス・トークンでブラウザから直接アップロードする
    expect(storageCalls).toHaveLength(1);
    expect(storageCalls[0]).toMatchObject({ bucket: 'upload-quarantine', path: 'org-1/idea-imports/u-1.xlsx', token: 'tok' });
    expect(storageCalls[0].file).toBe(file);

    // ③ 取込 API には JSON でパス・ファイル名・GWP モデル・ライセンス確認を渡す（ファイル本体は送らない）
    const [importInput, importInit] = fetchMock.mock.calls[1];
    expect(importInput).toBe('/api/idea-imports');
    expect(importInit?.method).toBe('POST');
    expect(JSON.parse(String(importInit?.body))).toEqual({
      storagePath: 'org-1/idea-imports/u-1.xlsx',
      fileName: 'IDEA_dummy.xlsx',
      gwpModel: 'IPCC 2021 GWP 100a without LULUCF',
      licenseConfirmed: true,
    });
  });

  it('URL 発行が拒否されたらサーバのメッセージで throw し、アップロードしない', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'ファイルサイズが上限（50MB）を超えています' }));
    await expect(startIdeaImport(file, 'IPCC 2021 GWP 100a without LULUCF', true)).rejects.toThrow(
      'ファイルサイズが上限（50MB）を超えています',
    );
    expect(storageCalls).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Storage へのアップロードに失敗したら取込 API を呼ばない', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { bucket: 'upload-quarantine', storagePath: 'org-1/idea-imports/u-1.xlsx', token: 'tok' }),
    );
    storageUploadError = { message: 'network' };
    await expect(startIdeaImport(file, 'IPCC 2021 GWP 100a without LULUCF', true)).rejects.toThrow(
      'ファイルのアップロードに失敗しました',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('取込 API のエラーはそのメッセージで throw する', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { bucket: 'upload-quarantine', storagePath: 'org-1/idea-imports/u-1.xlsx', token: 'tok' }),
      )
      .mockResolvedValueOnce(jsonResponse(409, { error: 'IDEAデータベースの取込が進行中です。完了後に再度お試しください' }));
    await expect(startIdeaImport(file, 'IPCC 2021 GWP 100a without LULUCF', true)).rejects.toThrow(
      'IDEAデータベースの取込が進行中です',
    );
  });
});

describe('requestStaleIdeaImportRecovery', () => {
  it('回収 API を POST で呼ぶ', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

    await requestStaleIdeaImportRecovery(fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith('/api/idea-imports/recovery', { method: 'POST' });
  });

  it('通信に失敗しても throw しない（取込中のポーリングは続け、次の呼び出しで再試行する）', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(requestStaleIdeaImportRecovery(fetchMock as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});

// ---- 年度ごとの版（取込履歴・割り当て）----
// 上の擬似DB（idea_imports だけを模す）とは別に、テーブルごとの応答を返すクライアントで検証する。

describe('年度ごとの版のクライアントサービス', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/supabase/client');
    vi.resetModules();
  });

  /** テーブルごとに応答を返し、呼び出し（select の引数・eq）を記録する Supabase クライアントのスタブ */
  const loadWithClient = async (respond: (table: string, eqs: [string, unknown][]) => unknown) => {
    const calls: { table: string; select: unknown[]; eqs: [string, unknown][] }[] = [];
    vi.resetModules();
    vi.doMock('@/lib/supabase/client', () => ({
      createClient: () => ({
        from: (table: string) => {
          const call = { table, select: [] as unknown[], eqs: [] as [string, unknown][] };
          calls.push(call);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST のチェーンを模したスタブ
          const builder: any = {
            select: (...args: unknown[]) => {
              call.select = args;
              return builder;
            },
            eq: (column: string, value: unknown) => {
              call.eqs.push([column, value]);
              return builder;
            },
            order: () => builder,
            maybeSingle: async () => respond(table, call.eqs),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(respond(table, call.eqs)).then(resolve),
          };
          return builder;
        },
      }),
    }));
    const clientModule = await import('../ideaImportClient');
    return { clientModule, calls };
  };

  it('fetchIdeaImportHistory: 完了した版・年度の割り当て・版ごとの算定結果からの参照件数を返す', async () => {
    const { clientModule, calls } = await loadWithClient((table, eqs) => {
      if (table === 'idea_imports') {
        return { data: [makeRecord({ id: 'imp-2', version: 'V2', isActive: true }), makeRecord({ id: 'imp-1', version: 'V1' })], error: null };
      }
      if (table === 'idea_fiscal_year_imports') {
        return { data: [{ fiscalYearId: 'fy-2024', importId: 'imp-1' }], error: null };
      }
      // emission_results: 版ごとの件数（head）
      const importId = eqs.find(([column]) => column === 'idea_factors.importId')?.[1];
      return { count: importId === 'imp-1' ? 12 : 0, data: null, error: null };
    });

    const history = await clientModule.fetchIdeaImportHistory();

    expect(history.imports.map((record) => record.id)).toEqual(['imp-2', 'imp-1']);
    expect(history.assignments).toEqual([{ fiscalYearId: 'fy-2024', importId: 'imp-1' }]);
    expect(history.referenceCountByImportId).toEqual({ 'imp-2': 0, 'imp-1': 12 });
    // 取込履歴は完了した版だけ
    expect(calls.find((call) => call.table === 'idea_imports')?.eqs).toContainEqual(['status', 'completed']);
    // 参照件数は件数だけを取る（行は取らない）
    const countCall = calls.find((call) => call.table === 'emission_results');
    expect(countCall?.select[1]).toEqual({ count: 'exact', head: true });
  });

  it('fetchIdeaImportForFiscalYear: 年度に割り当てた版（版の表記つき）を返し、割り当てが無ければ null', async () => {
    const { clientModule } = await loadWithClient((_table, eqs) =>
      eqs.some(([, value]) => value === 'fy-2024')
        ? { data: { importId: 'imp-1', idea_imports: { version: 'V1' } }, error: null }
        : { data: null, error: null },
    );

    await expect(clientModule.fetchIdeaImportForFiscalYear('fy-2024')).resolves.toEqual({ importId: 'imp-1', version: 'V1' });
    await expect(clientModule.fetchIdeaImportForFiscalYear('fy-2025')).resolves.toBeNull();
  });

  it('assignIdeaImportToFiscalYear: 年度と版を POST し、付け替えの件数を返す。失敗時はサーバーの文言で throw する', async () => {
    const { clientModule } = await loadWithClient(() => ({ data: null, error: null }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ importId: 'imp-1', remappedCount: 3, unmappedCount: 1 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '会計年度が見つかりません' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(clientModule.assignIdeaImportToFiscalYear('fy-2024', 'imp-1')).resolves.toEqual({
      importId: 'imp-1',
      remappedCount: 3,
      unmappedCount: 1,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/idea-imports/fiscal-year-assignment');
    expect(JSON.parse(init.body as string)).toEqual({ fiscalYearId: 'fy-2024', importId: 'imp-1' });

    await expect(clientModule.assignIdeaImportToFiscalYear('fy-x', null)).rejects.toThrow('会計年度が見つかりません');
  });
});
