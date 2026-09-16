// ideaImportClient のテスト。
// - fetchIdeaImportOverview の回帰: 「直近N件から rows.find(isActive)」で active を探すと、失敗履歴が
//   N 件を超えて蓄積したときに active 行がウィンドウ外へ落ち、取込済みなのに未取込表示になる。
//   active は専用クエリ（isActive = true）で取得することを保証する。
// - startIdeaImport: 署名付き URL 発行 → Storage へ直接アップロード → パスだけを取込 API へ渡す
//   3 段階の経路（ファイル本体を API に送らない）を検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIdeaImportOverview,
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
