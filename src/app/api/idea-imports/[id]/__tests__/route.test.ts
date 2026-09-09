// DELETE /api/idea-imports/[id] の Route Handler テスト（§3.6-4）。
// 参照有りインポートの削除拒否（409）と、RPC エラーコードのマッピングを検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createAdminClient: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn() },
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

import { IDEA_IMPORT_SQLSTATE } from '@/features/factors/services/ideaImportServer';
import { DELETE } from '../route';

const IMPORT_ID = '019890ab-1234-4cde-8f01-23456789abcd';

const request = () =>
  new Request(`http://localhost/api/idea-imports/${IMPORT_ID}`, { method: 'DELETE' });

const params = (id: string = IMPORT_ID) => ({ params: Promise.resolve({ id }) });

const stubSupabase = (rpcResult: { data: unknown; error: { code?: string } | null }) => ({
  rpc: vi.fn(async () => rpcResult),
});

describe('DELETE /api/idea-imports/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    const response = await DELETE(request(), params());
    expect(response.status).toBe(401);
  });

  it('UUIDでないIDは404', async () => {
    const response = await DELETE(request(), params('not-a-uuid'));
    expect(response.status).toBe(404);
  });

  it('存在しない・他組織のインポート（P2031）は404', async () => {
    const supabase = stubSupabase({
      data: null,
      error: { code: IDEA_IMPORT_SQLSTATE.importInvalid },
    });
    mocks.createAdminClient.mockReturnValue(supabase);

    const response = await DELETE(request(), params());
    expect(response.status).toBe(404);
  });

  it('emission_results から参照されている場合（P2032）は409で拒否する（§3.6-4）', async () => {
    const supabase = stubSupabase({
      data: null,
      error: { code: IDEA_IMPORT_SQLSTATE.importReferenced },
    });
    mocks.createAdminClient.mockReturnValue(supabase);

    const response = await DELETE(request(), params());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('算定結果から参照されているため削除できません');
  });

  it('正常系: 自組織スコープでRPCを呼び 200 を返す', async () => {
    const supabase = stubSupabase({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue(supabase);

    const response = await DELETE(request(), params());
    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith('delete_idea_import', {
      p_import_id: IMPORT_ID,
      p_organization_id: 'org-1',
    });
  });
});
