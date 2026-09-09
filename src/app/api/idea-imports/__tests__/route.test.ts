// POST /api/idea-imports の Route Handler テスト。
// 認証・入力検証・進行中チェック・「processing / isActive=false で作成」（§4.1-3）を検証する。
// 取込本体（processIdeaImport）はモックし、応答後実行（after）への引き渡しのみ確認する。

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
import { IDEA_IMPORT_MAX_FILE_SIZE_BYTES } from '@/features/factors/services/ideaImportServer';
import { POST } from '../route';

/** xlsx（ZIPコンテナ）のマジックナンバー付きダミーバイト列 */
const xlsxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);

const buildRequest = ({
  fileName = 'IDEA_dummy.xlsx',
  bytes = xlsxBytes,
  gwpModel = DEFAULT_IDEA_GWP_MODEL,
  licenseConfirmed = 'true',
  withFile = true,
  contentLength,
}: {
  fileName?: string;
  bytes?: Uint8Array;
  gwpModel?: string | null;
  licenseConfirmed?: string | null;
  withFile?: boolean;
  /** 指定時は Content-Length ヘッダを明示的に付ける（実ボディの長さとは無関係。事前チェックの検証用） */
  contentLength?: string;
} = {}) => {
  const formData = new FormData();
  if (withFile) {
    formData.append('file', new File([bytes as BlobPart], fileName));
  }
  if (gwpModel !== null) formData.append('gwpModel', gwpModel);
  if (licenseConfirmed !== null) formData.append('licenseConfirmed', licenseConfirmed);
  const headers = contentLength === undefined ? undefined : { 'content-length': contentLength };
  return new Request('http://localhost/api/idea-imports', { method: 'POST', body: formData, headers });
};

interface StubOptions {
  /** 進行中チェック（select … limit）の呼び出しごとの結果。足りない分は最後の値を使い回す */
  processingRowsPerCall?: { id: string }[][];
  insertedId?: string;
}

/** idea_imports の滞留回収・進行中チェック・INSERT だけを持つ管理クライアントのスタブ */
const stubSupabase = ({ processingRowsPerCall = [[]], insertedId = 'import-1' }: StubOptions = {}) => {
  const insertedRows: Record<string, unknown>[] = [];
  let processingCalls = 0;
  const client = {
    from: vi.fn(() => ({
      // 滞留回収: update().eq().eq().lt()
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            lt: vi.fn(async () => ({ error: null })),
          })),
        })),
      })),
      // 進行中チェック: select().eq().eq().limit()
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn(async () => {
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
            single: vi.fn(async () => ({ data: { id: insertedId }, error: null })),
          })),
        };
      }),
    })),
  };
  return { client, insertedRows, processingCallCount: () => processingCalls };
};

describe('POST /api/idea-imports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
    mocks.log.child.mockReturnValue(mocks.log);
    // 進行中チェックはボディ解析より先に走るため、入力検証のテストでも DB スタブが要る。
    mocks.createAdminClient.mockReturnValue(stubSupabase().client);
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    const response = await POST(buildRequest());
    expect(response.status).toBe(401);
  });

  it('ファイル未指定は400', async () => {
    const response = await POST(buildRequest({ withFile: false }));
    expect(response.status).toBe(400);
  });

  it('ライセンス確認なしは400（サーバ側でも必須）', async () => {
    const response = await POST(buildRequest({ licenseConfirmed: 'false' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('ライセンス');
  });

  it('未対応のGWPモデルは400', async () => {
    const response = await POST(buildRequest({ gwpModel: 'ダミーモデル' }));
    expect(response.status).toBe(400);
  });

  it('xlsx以外の拡張子は400', async () => {
    const response = await POST(buildRequest({ fileName: 'IDEA_dummy.csv' }));
    expect(response.status).toBe(400);
  });

  describe('Content-Length の事前チェック（ボディを読む前にサイズ超過を弾く）', () => {
    it('上限を明らかに超える Content-Length は413（DB にもボディにも触れない）', async () => {
      const { client } = stubSupabase();
      mocks.createAdminClient.mockReturnValue(client);

      const tooLarge = String(IDEA_IMPORT_MAX_FILE_SIZE_BYTES + 64 * 1024 + 1);
      const response = await POST(buildRequest({ contentLength: tooLarge }));
      expect(response.status).toBe(413);
      const body = await response.json();
      // 本体検証（validateIdeaImportFile）と同じ文言で返す
      expect(body.error).toBe('ファイルサイズが上限（50MB）を超えています');
      expect(client.from).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    });

    it('上限以内の Content-Length はそのまま本体処理へ進む', async () => {
      const response = await POST(buildRequest({ contentLength: String(IDEA_IMPORT_MAX_FILE_SIZE_BYTES) }));
      expect(response.status).toBe(202);
    });

    it('Content-Length が数値でなければ事前チェックは行わず本体検証に任せる', async () => {
      const response = await POST(buildRequest({ contentLength: 'not-a-number' }));
      expect(response.status).toBe(202);
    });
  });

  it('進行中の取込がある場合は409（ボディを解析する前に返す）', async () => {
    const { client, insertedRows } = stubSupabase({ processingRowsPerCall: [[{ id: 'import-0' }]] });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await POST(buildRequest());
    expect(response.status).toBe(409);
    expect(insertedRows).toHaveLength(0);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('入口チェック通過後、INSERT 直前の再確認で進行中が見つかれば409（並行リクエストの割り込み）', async () => {
    // 1回目（ボディ読込前）は空、2回目（INSERT 直前）は別リクエストが作った processing 行が見える
    const { client, insertedRows, processingCallCount } = stubSupabase({
      processingRowsPerCall: [[], [{ id: 'import-other' }]],
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await POST(buildRequest());
    expect(response.status).toBe(409);
    expect(processingCallCount()).toBe(2);
    expect(insertedRows).toHaveLength(0);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('進行中チェックが DB エラーなら500', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
            })),
          })),
        })),
      })),
    };
    mocks.createAdminClient.mockReturnValue(client);

    const response = await POST(buildRequest());
    expect(response.status).toBe(500);
    expect(mocks.log.error).toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('正常系: processing / isActive=false で作成し、202と importId を返して本体処理を after へ渡す', async () => {
    const { client, insertedRows, processingCallCount } = stubSupabase();
    mocks.createAdminClient.mockReturnValue(client);

    const response = await POST(buildRequest());
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.importId).toBe('import-1');

    // 進行中チェックは「ボディ読込前」と「INSERT 直前」の2回
    expect(processingCallCount()).toBe(2);

    // §4.1-3: isActive=true で作ると2回目以降の取込が部分一意インデックスに衝突する
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      organizationId: 'org-1',
      status: 'processing',
      isActive: false,
      gwpModel: DEFAULT_IDEA_GWP_MODEL,
      fileName: 'IDEA_dummy.xlsx',
      importedByUserId: 'user-1',
    });

    // 取込本体は応答後実行（after）に渡される
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const deferred = mocks.after.mock.calls[0][0] as () => unknown;
    deferred();
    expect(mocks.processIdeaImport).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: 'import-1',
        organizationId: 'org-1',
        gwpModel: DEFAULT_IDEA_GWP_MODEL,
      }),
    );
  });
});
