// POST /api/idea-imports/upload-url の Route Handler テスト。
// 認証・申告値（ファイル名・サイズ）の事前検証・レート制限・進行中チェック・
// 「自組織フォルダ配下のパスにだけ署名付き URL を発行する」・応答後の掃除を検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createAdminClient: vi.fn(),
  after: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn() },
}));

// after() はリクエストコンテキスト外では実行できないため、呼び出しの記録だけに差し替える。
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: vi.fn(async () => mocks.log),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import {
  IDEA_IMPORT_MAX_FILE_SIZE_BYTES,
  IDEA_UPLOAD_BUCKET,
  IDEA_UPLOAD_URL_RATE_LIMIT,
  isIdeaUploadPathForOrganization,
  resetIdeaUploadUrlQuota,
} from '@/features/factors/services/ideaImportServer';
import { POST } from '../route';

const ORG_ID = '0198a0b1-1111-4aaa-8bbb-000000000001';

const buildRequest = (body: Record<string, unknown> | string) =>
  new Request('http://localhost/api/idea-imports/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const stubSupabase = (
  result: { data: { path: string; token: string; signedUrl: string } | null; error: { message: string } | null } | null = null,
  staleObjects: { name: string; id: string | null; created_at: string | null }[] = [],
  processingRows: { id: string }[] = [],
) => {
  const requestedPaths: string[] = [];
  const buckets: string[] = [];
  const removedPaths: string[][] = [];
  const client = {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ lt: vi.fn(async () => ({ error: null })) })) })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ limit: vi.fn(async () => ({ data: processingRows, error: null })) })),
        })),
      })),
    })),
    storage: {
      from: vi.fn((bucket: string) => {
        buckets.push(bucket);
        return {
          list: vi.fn(async () => ({ data: staleObjects, error: null })),
          remove: vi.fn(async (paths: string[]) => {
            removedPaths.push(paths);
            return { data: [], error: null };
          }),
          createSignedUploadUrl: vi.fn(async (path: string) => {
            requestedPaths.push(path);
            return (
              result ?? {
                data: { path, token: 'signed-token', signedUrl: `https://storage.example/${path}` },
                error: null,
              }
            );
          }),
        };
      }),
    },
  };
  return { client, requestedPaths, buckets, removedPaths };
};

describe('POST /api/idea-imports/upload-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIdeaUploadUrlQuota();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: ORG_ID });
    mocks.createAdminClient.mockReturnValue(stubSupabase().client);
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    const response = await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: 1024 }));
    expect(response.status).toBe(401);
  });

  it('JSON でない・fileName / fileSize の型が違うボディは400', async () => {
    expect((await POST(buildRequest('not json'))).status).toBe(400);
    expect((await POST(buildRequest({ fileName: 'IDEA.xlsx' }))).status).toBe(400);
    expect((await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: '1024' }))).status).toBe(400);
  });

  it('xlsx 以外・サイズ超過・空ファイルは URL を発行せず400（数十MBを上げてから失敗させない）', async () => {
    const stub = stubSupabase();
    mocks.createAdminClient.mockReturnValue(stub.client);

    const csv = await POST(buildRequest({ fileName: 'IDEA.csv', fileSize: 1024 }));
    expect(csv.status).toBe(400);
    const tooLarge = await POST(
      buildRequest({ fileName: 'IDEA.xlsx', fileSize: IDEA_IMPORT_MAX_FILE_SIZE_BYTES + 1 }),
    );
    expect(tooLarge.status).toBe(400);
    expect((await tooLarge.json()).error).toBe('ファイルサイズが上限（50MB）を超えています');
    const empty = await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: 0 }));
    expect(empty.status).toBe(400);

    expect(stub.requestedPaths).toEqual([]);
  });

  it('正常系: upload-quarantine の自組織フォルダ配下に署名付き URL を発行し、bucket / storagePath / token を返す', async () => {
    const stub = stubSupabase();
    mocks.createAdminClient.mockReturnValue(stub.client);

    const response = await POST(buildRequest({ fileName: '../evil/IDEA.xlsx', fileSize: 30 * 1024 * 1024 }));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.bucket).toBe(IDEA_UPLOAD_BUCKET);
    expect(new Set(stub.buckets)).toEqual(new Set([IDEA_UPLOAD_BUCKET]));
    expect(body.token).toBe('signed-token');
    // 発行したパスは自組織向けの形式（取込 API 側の組織チェックを通る）。利用者のファイル名は使わない
    expect(stub.requestedPaths).toHaveLength(1);
    expect(body.storagePath).toBe(stub.requestedPaths[0]);
    expect(isIdeaUploadPathForOrganization(body.storagePath, ORG_ID)).toBe(true);
    expect(body.storagePath.startsWith(`${ORG_ID}/`)).toBe(true);
    expect(body.storagePath).not.toContain('evil');
    // signedUrl は返さない（ブラウザは path + token でアップロードする）
    expect(body.signedUrl).toBeUndefined();
  });

  it('発行のついでに、自組織フォルダの取り残しファイル（閾値超過）を応答後に削除する', async () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(Date.now() - 60 * 1000).toISOString();
    const stub = stubSupabase(null, [
      { name: 'old.xlsx', id: 'id-1', created_at: old },
      { name: 'fresh.xlsx', id: 'id-2', created_at: fresh },
    ]);
    mocks.createAdminClient.mockReturnValue(stub.client);

    const response = await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: 1024 }));
    expect(response.status).toBe(200);
    // 掃除は応答後実行（after）に渡され、応答時点では削除していない
    expect(stub.removedPaths).toEqual([]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await (mocks.after.mock.calls[0][0] as () => Promise<unknown>)();
    expect(stub.removedPaths).toEqual([[`${ORG_ID}/idea-imports/old.xlsx`]]);
  });

  it('進行中の取込がある組織には発行せず409（数十MBを上げてから失敗させない）', async () => {
    const stub = stubSupabase(null, [], [{ id: 'import-0' }]);
    mocks.createAdminClient.mockReturnValue(stub.client);
    const response = await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: 1024 }));
    expect(response.status).toBe(409);
    expect(stub.requestedPaths).toEqual([]);
  });

  it('組織単位のレート制限を超えたら429（Retry-After 付き）で、URL を発行しない', async () => {
    const stub = stubSupabase();
    mocks.createAdminClient.mockReturnValue(stub.client);
    for (let index = 0; index < IDEA_UPLOAD_URL_RATE_LIMIT.limit; index++) {
      expect((await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: 1024 }))).status).toBe(200);
    }
    const limited = await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: 1024 }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe(String(IDEA_UPLOAD_URL_RATE_LIMIT.windowMs / 1000));
    expect(stub.requestedPaths).toHaveLength(IDEA_UPLOAD_URL_RATE_LIMIT.limit);

    // 別組織は別枠
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-2', organizationId: '0198a0b1-2222-4aaa-8bbb-000000000002' });
    expect((await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: 1024 }))).status).toBe(200);
  });

  it('署名付き URL の発行に失敗したら500', async () => {
    const stub = stubSupabase({ data: null, error: { message: 'boom' } });
    mocks.createAdminClient.mockReturnValue(stub.client);
    const response = await POST(buildRequest({ fileName: 'IDEA.xlsx', fileSize: 1024 }));
    expect(response.status).toBe(500);
    expect(mocks.log.error).toHaveBeenCalled();
  });
});
