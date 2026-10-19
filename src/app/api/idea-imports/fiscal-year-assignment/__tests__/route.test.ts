// POST /api/idea-imports/fiscal-year-assignment の Route Handler テスト（§3.6-5）。
// 入力の検証、組織をプロフィールから取ること、RPC エラーコードの対応を検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createAdminClient: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

// getRequestLogger は next/headers に依存するため、Route の単体テストではモックする。
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: vi.fn(async () => mocks.log),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { IDEA_IMPORT_SQLSTATE } from '@/features/factors/services/ideaImportServer';
import { POST } from '../route';

const FISCAL_YEAR_ID = '11111111-0000-0000-0000-000000002024';
const IMPORT_ID = '019890ab-1234-4cde-8f01-23456789abcd';

const request = (body: unknown) =>
  new Request('http://localhost/api/idea-imports/fiscal-year-assignment', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const stubSupabase = (rpcResult: { data: unknown; error: { code?: string } | null }) => {
  const rpc = vi.fn(async () => rpcResult);
  mocks.createAdminClient.mockReturnValue({ rpc });
  return rpc;
};

describe('POST /api/idea-imports/fiscal-year-assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    const response = await POST(request({ fiscalYearId: FISCAL_YEAR_ID, importId: IMPORT_ID }));
    expect(response.status).toBe(401);
  });

  it('fiscalYearId が UUID でない・importId が文字列でも null でもない場合は400', async () => {
    const rpc = stubSupabase({ data: null, error: null });
    expect((await POST(request({ fiscalYearId: 'fy-2024', importId: IMPORT_ID }))).status).toBe(400);
    expect((await POST(request({ fiscalYearId: FISCAL_YEAR_ID }))).status).toBe(400);
    expect((await POST(request({ fiscalYearId: FISCAL_YEAR_ID, importId: 123 }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ログイン中プロフィールの組織と利用者で割り当て、付け替えの件数を返す（body の組織IDは受け取らない）', async () => {
    const rpc = stubSupabase({ data: { importId: IMPORT_ID, remappedCount: 3, unmappedCount: 1 }, error: null });

    const response = await POST(
      request({ fiscalYearId: FISCAL_YEAR_ID, importId: IMPORT_ID, organizationId: 'other-org' }),
    );

    expect(rpc).toHaveBeenCalledWith('assign_idea_import_to_fiscal_year', {
      p_organization_id: 'org-1',
      p_fiscal_year_id: FISCAL_YEAR_ID,
      p_import_id: IMPORT_ID,
      p_user_id: 'user-1',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ importId: IMPORT_ID, remappedCount: 3, unmappedCount: 1 });
  });

  it('importId = null は割り当てを外す（RPC に null を渡す）', async () => {
    const rpc = stubSupabase({ data: { importId: null, remappedCount: 0, unmappedCount: 0 }, error: null });

    const response = await POST(request({ fiscalYearId: FISCAL_YEAR_ID, importId: null }));

    expect(rpc).toHaveBeenCalledWith('assign_idea_import_to_fiscal_year', expect.objectContaining({ p_import_id: null }));
    expect(response.status).toBe(200);
  });

  it('他組織・存在しない年度（P2034）と、未完了・他組織の版（P2031）は404', async () => {
    stubSupabase({ data: null, error: { code: IDEA_IMPORT_SQLSTATE.fiscalYearInvalid } });
    expect((await POST(request({ fiscalYearId: FISCAL_YEAR_ID, importId: IMPORT_ID }))).status).toBe(404);
    stubSupabase({ data: null, error: { code: IDEA_IMPORT_SQLSTATE.importInvalid } });
    expect((await POST(request({ fiscalYearId: FISCAL_YEAR_ID, importId: IMPORT_ID }))).status).toBe(404);
  });

  it('その他の失敗は内部エラーの詳細を返さない', async () => {
    stubSupabase({ data: null, error: { code: '42501' } });
    const response = await POST(request({ fiscalYearId: FISCAL_YEAR_ID, importId: IMPORT_ID }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'サーバー内部エラーが発生しました' });
  });
});
