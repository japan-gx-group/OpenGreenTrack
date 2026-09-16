// POST /api/idea-imports の Route Handler テスト。
// 認証・入力検証・Storage パスの組織チェック・滞留行の回収と進行中チェックの順序・
// 「processing / isActive=false で作成」（§4.1-3）・quarantine ファイルの後片付けを検証する。
// 取込本体（processIdeaImport）はモックし、応答後実行（after）への引き渡しのみ確認する。
// 入力検証のテストでも DB スタブが要る: 検証で拒否した場合に Storage の remove を呼ぶため。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createAdminClient: vi.fn(),
  processIdeaImport: vi.fn(),
  after: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

// getRequestLogger は next/headers に依存するため、Route の単体テストではモックする。
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: vi.fn(async () => mocks.log),
}));

// after() はリクエストコンテキスト外では実行できないため、呼び出しの記録だけに差し替える。
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/features/factors/services/ideaImportServer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/factors/services/ideaImportServer')>()),
  processIdeaImport: mocks.processIdeaImport,
}));

import { DEFAULT_IDEA_GWP_MODEL } from '@/features/factors/services/ideaImport';
import {
  IDEA_IMPORT_MAX_FILE_SIZE_BYTES,
  IDEA_UPLOAD_BUCKET,
  buildIdeaUploadPath,
} from '@/features/factors/services/ideaImportServer';
import { POST } from '../route';

const ORG_ID = '0198a0b1-1111-4aaa-8bbb-000000000001';
const OTHER_ORG_ID = '0198a0b1-2222-4aaa-8bbb-000000000002';
const UPLOAD_ID = '0198a0b1-3333-4aaa-8bbb-000000000003';
const STORAGE_PATH = buildIdeaUploadPath(ORG_ID, UPLOAD_ID);

/** xlsx（ZIPコンテナ）のマジックナンバー付きダミーバイト列 */
const xlsxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);

const buildRequest = (
  body: Record<string, unknown> | string = {},
  {
    storagePath = STORAGE_PATH,
    fileName = 'IDEA_dummy.xlsx',
    gwpModel = DEFAULT_IDEA_GWP_MODEL,
    licenseConfirmed = true as unknown,
  }: {
    storagePath?: unknown;
    fileName?: unknown;
    gwpModel?: unknown;
    licenseConfirmed?: unknown;
  } = {},
) =>
  new Request('http://localhost/api/idea-imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:
      typeof body === 'string'
        ? body
        : JSON.stringify({ storagePath, fileName, gwpModel, licenseConfirmed, ...body }),
  });

interface StubOptions {
  /** 進行中チェック（select … limit）の呼び出しごとの結果。足りない分は最後の値を使い回す */
  processingRowsPerCall?: { id: string }[][];
  insertedId?: string;
  /** INSERT が返すエラー（23505 = 部分一意インデックスの衝突） */
  insertError?: { code: string; message: string } | null;
  /** Storage に置かれているファイルの中身（null = 存在しない） */
  storedFile?: Buffer | null;
  /** info() が返すサイズ（既定は storedFile の長さ）。上限超過の検証用 */
  storedSize?: number;
  /** Storage の info() を「見つからない」以外のエラーにする */
  storageError?: { message: string; statusCode?: string } | null;
}

/** idea_imports の滞留回収・進行中チェック・INSERT と、Storage の download / remove を持つ管理クライアントのスタブ */
const stubSupabase = ({
  processingRowsPerCall = [[]],
  insertedId = 'import-1',
  insertError = null,
  storedFile = xlsxBytes,
  storedSize,
  storageError = null,
}: StubOptions = {}) => {
  const insertedRows: Record<string, unknown>[] = [];
  const removedPaths: string[][] = [];
  const downloadedPaths: string[] = [];
  const buckets: string[] = [];
  /** 呼び出し順の記録（滞留回収が進行中チェックより先であることの検証用） */
  const sequence: string[] = [];
  let processingCalls = 0;
  const notFound = { message: 'Object not found', statusCode: '404' };
  const client = {
    from: vi.fn(() => ({
      // 滞留回収: update().eq().eq().lt()
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            lt: vi.fn(async () => {
              sequence.push('recover');
              return { error: null };
            }),
          })),
        })),
      })),
      // 進行中チェック: select().eq().eq().limit()
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn(async () => {
              sequence.push('check');
              const index = Math.min(processingCalls, processingRowsPerCall.length - 1);
              processingCalls += 1;
              return { data: processingRowsPerCall[index], error: null };
            }),
          })),
        })),
      })),
      // 作成: insert().select().single()
      insert: vi.fn((values: Record<string, unknown>) => {
        insertedRows.push(values);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () =>
              insertError ? { data: null, error: insertError } : { data: { id: insertedId }, error: null },
            ),
          })),
        };
      }),
    })),
    storage: {
      from: vi.fn((bucket: string) => {
        buckets.push(bucket);
        return {
          info: vi.fn(async () => {
            if (storageError) return { data: null, error: storageError };
            if (storedFile === null) return { data: null, error: notFound };
            return { data: { size: storedSize ?? storedFile.byteLength }, error: null };
          }),
          download: vi.fn(async (path: string) => {
            downloadedPaths.push(path);
            if (storedFile === null) return { data: null, error: notFound };
            return { data: new Blob([Uint8Array.from(storedFile)]), error: null };
          }),
          remove: vi.fn(async (paths: string[]) => {
            removedPaths.push(paths);
            return { data: [], error: null };
          }),
        };
      }),
    },
  };
  return {
    client,
    insertedRows,
    removedPaths,
    downloadedPaths,
    buckets,
    sequence,
    processingCallCount: () => processingCalls,
  };
};

describe('POST /api/idea-imports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: ORG_ID });
    mocks.log.child.mockReturnValue(mocks.log);
    mocks.createAdminClient.mockReturnValue(stubSupabase().client);
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    const response = await POST(buildRequest());
    expect(response.status).toBe(401);
  });

  it('JSON でないボディは400', async () => {
    const response = await POST(buildRequest('not json'));
    expect(response.status).toBe(400);
  });

  describe('storagePath の組織チェック（他組織のパス・任意パスでの取込を拒否する）', () => {
    it.each([
      ['他組織のフォルダ', buildIdeaUploadPath(OTHER_ORG_ID, UPLOAD_ID)],
      ['組織フォルダ直下の任意ファイル', `${ORG_ID}/secret.xlsx`],
      ['パス・トラバーサル', `${ORG_ID}/idea-imports/../../${OTHER_ORG_ID}/idea-imports/${UPLOAD_ID}.xlsx`],
      ['xlsx 以外', `${ORG_ID}/idea-imports/${UPLOAD_ID}.csv`],
      ['文字列でない', 123],
      ['未指定（null）', null],
    ])('%s は400で、Storage にもDBにも触れない', async (_label, storagePath) => {
      const stub = stubSupabase();
      mocks.createAdminClient.mockReturnValue(stub.client);

      const response = await POST(buildRequest({}, { storagePath }));
      expect(response.status).toBe(400);
      expect(stub.client.from).not.toHaveBeenCalled();
      expect(stub.client.storage.from).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    });
  });

  describe('入力不備は400にし、quarantine のファイルを削除する', () => {
    it('ファイル名なし', async () => {
      const stub = stubSupabase();
      mocks.createAdminClient.mockReturnValue(stub.client);
      const response = await POST(buildRequest({}, { fileName: '' }));
      expect(response.status).toBe(400);
      expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
    });

    it('ライセンス確認なし（サーバ側でも必須）', async () => {
      const stub = stubSupabase();
      mocks.createAdminClient.mockReturnValue(stub.client);
      const response = await POST(buildRequest({}, { licenseConfirmed: false }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('ライセンス');
      expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
    });

    it('未対応のGWPモデル', async () => {
      const stub = stubSupabase();
      mocks.createAdminClient.mockReturnValue(stub.client);
      const response = await POST(buildRequest({}, { gwpModel: 'ダミーモデル' }));
      expect(response.status).toBe(400);
      expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
    });

    it('xlsx以外の拡張子', async () => {
      const stub = stubSupabase();
      mocks.createAdminClient.mockReturnValue(stub.client);
      const response = await POST(buildRequest({}, { fileName: 'IDEA_dummy.csv' }));
      expect(response.status).toBe(400);
      expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
    });

    it('ZIP シグネチャの無いファイル（実バイト列の検証はサーバ側で行う）', async () => {
      const stub = stubSupabase({ storedFile: Buffer.from('plain text') });
      mocks.createAdminClient.mockReturnValue(stub.client);
      const response = await POST(buildRequest());
      expect(response.status).toBe(400);
      expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
      expect(mocks.after).not.toHaveBeenCalled();
    });
  });

  it('Storage にファイルが無ければ400（削除するものが無いので remove は呼ばない）', async () => {
    const stub = stubSupabase({ storedFile: null });
    mocks.createAdminClient.mockReturnValue(stub.client);
    const response = await POST(buildRequest());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('見つかりません');
    expect(stub.removedPaths).toEqual([]);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('Storage 上のサイズが上限超過ならダウンロードせず400にし、ファイルを削除する', async () => {
    const stub = stubSupabase({ storedSize: IDEA_IMPORT_MAX_FILE_SIZE_BYTES + 1 });
    mocks.createAdminClient.mockReturnValue(stub.client);
    const response = await POST(buildRequest());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('ファイルサイズが上限（50MB）を超えています');
    expect(stub.downloadedPaths).toEqual([]);
    expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
  });

  it('Storage の取得が「見つからない」以外で失敗したら500にし、ファイルは削除する（見つからない扱いにしない）', async () => {
    const stub = stubSupabase({ storageError: { message: 'upstream timeout', statusCode: '504' } });
    mocks.createAdminClient.mockReturnValue(stub.client);
    const response = await POST(buildRequest());
    expect(response.status).toBe(500);
    expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
    expect(mocks.log.error).toHaveBeenCalled();
  });

  it('滞留行の回収を進行中チェックより先に行う（中断された取込で組織が永久に409にならない）', async () => {
    const stub = stubSupabase();
    mocks.createAdminClient.mockReturnValue(stub.client);
    const response = await POST(buildRequest());
    expect(response.status).toBe(202);
    expect(stub.sequence).toEqual(['recover', 'check']);
  });

  it('進行中の取込がある場合は409（Storage からファイルを取得する前に返し、ファイルは削除する）', async () => {
    const stub = stubSupabase({ processingRowsPerCall: [[{ id: 'import-0' }]] });
    mocks.createAdminClient.mockReturnValue(stub.client);

    const response = await POST(buildRequest());
    expect(response.status).toBe(409);
    expect(stub.downloadedPaths).toEqual([]);
    expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
    expect(stub.insertedRows).toHaveLength(0);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('入口チェック通過後に別リクエストが先に INSERT していれば、23505 を409にしてファイルを削除する（並行リクエストの割り込み）', async () => {
    const stub = stubSupabase({ insertError: { code: '23505', message: 'duplicate key' } });
    mocks.createAdminClient.mockReturnValue(stub.client);

    const response = await POST(buildRequest());
    expect(response.status).toBe(409);
    expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('進行中チェックが DB エラーなら500にし、ファイルは削除する（例外経路でも残置しない）', async () => {
    const stub = stubSupabase();
    stub.client.from = vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ lt: vi.fn(async () => ({ error: null })) })) })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
          })),
        })),
      })),
    })) as unknown as typeof stub.client.from;
    mocks.createAdminClient.mockReturnValue(stub.client);

    const response = await POST(buildRequest());
    expect(response.status).toBe(500);
    expect(mocks.log.error).toHaveBeenCalled();
    expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('正常系: Storage から取得 → processing / isActive=false で作成 → 202 → 本体処理後にファイルを削除する', async () => {
    const stub = stubSupabase();
    mocks.createAdminClient.mockReturnValue(stub.client);
    mocks.processIdeaImport.mockResolvedValue({ status: 'completed' });

    const response = await POST(buildRequest());
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.importId).toBe('import-1');

    // upload-quarantine から自組織向けパスのファイルを取得する
    expect(stub.buckets).toContain(IDEA_UPLOAD_BUCKET);
    expect(stub.downloadedPaths).toEqual([STORAGE_PATH]);

    // 進行中チェックはファイル取得前の 1 回（INSERT 時の割り込みは部分一意インデックスの 23505 で捕捉する）
    expect(stub.processingCallCount()).toBe(1);

    // §4.1-3: isActive=true で作ると2回目以降の取込が部分一意インデックスに衝突する
    expect(stub.insertedRows).toHaveLength(1);
    expect(stub.insertedRows[0]).toMatchObject({
      organizationId: ORG_ID,
      status: 'processing',
      isActive: false,
      gwpModel: DEFAULT_IDEA_GWP_MODEL,
      fileName: 'IDEA_dummy.xlsx',
      importedByUserId: 'user-1',
    });

    // 応答時点ではファイルはまだ削除されていない（本体処理が読む）
    expect(stub.removedPaths).toEqual([]);

    // 取込本体は応答後実行（after）に渡され、完了後に quarantine のファイルを削除する
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const deferred = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await deferred();
    expect(mocks.processIdeaImport).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: 'import-1',
        organizationId: ORG_ID,
        gwpModel: DEFAULT_IDEA_GWP_MODEL,
        fileBuffer: expect.any(Buffer),
      }),
    );
    expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
  });

  it('本体処理が例外で落ちても quarantine のファイルを削除する', async () => {
    const stub = stubSupabase();
    mocks.createAdminClient.mockReturnValue(stub.client);
    mocks.processIdeaImport.mockRejectedValue(new Error('unexpected'));

    const response = await POST(buildRequest());
    expect(response.status).toBe(202);
    const deferred = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await expect(deferred()).rejects.toThrow('unexpected');
    expect(stub.removedPaths).toEqual([[STORAGE_PATH]]);
  });
});
