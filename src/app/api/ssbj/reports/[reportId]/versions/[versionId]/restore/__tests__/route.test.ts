// POST /api/ssbj/reports/[reportId]/versions/[versionId]/restore の Route Handler テスト（docs/ssbj-spec.md §13「版の復元」）。
// 入力検証・認証ガード・操作者と組織をセッションから決めること・RPC エラーコードのマッピングを検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  rpc: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: mocks.getCurrentProfile }));
vi.mock('@/lib/logging/requestLogger', () => ({ getRequestLogger: vi.fn(async () => mocks.log) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { POST } from '../route';

const REPORT_ID = '019890ab-1234-4cde-8f01-23456789abcd';
const VERSION_ID = '019890ab-1234-4cde-8f01-23456789aaaa';

const request = (body: unknown) =>
  new Request(`http://localhost/api/ssbj/reports/${REPORT_ID}/versions/${VERSION_ID}/restore`, {
    method: 'POST', body: JSON.stringify(body),
  });
const params = (reportId = REPORT_ID, versionId = VERSION_ID) => ({ params: Promise.resolve({ reportId, versionId }) });

describe('POST /api/ssbj/reports/[reportId]/versions/[versionId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
  });

  it('未ログインは401、UUIDでない ID は404、版数が整数でなければ400', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    expect((await POST(request({ expectedDraftRevision: 1 }), params())).status).toBe(401);
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
    expect((await POST(request({ expectedDraftRevision: 1 }), params(REPORT_ID, 'x'))).status).toBe(404);
    expect((await POST(request({ expectedDraftRevision: 1.5 }), params())).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('操作者・組織はセッションから決めて RPC に渡し、戻す前の内容を保存した版を返す', async () => {
    const result = { restoredVersionNumber: 1, backupVersionId: 'backup', backupVersionNumber: 4, draftRevision: 12 };
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    const response = await POST(request({ expectedDraftRevision: 9 }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.rpc).toHaveBeenCalledWith('restore_ssbj_report_version', {
      p_report_id: REPORT_ID, p_organization_id: 'org-1', p_actor_user_id: 'user-1',
      p_version_id: VERSION_ID, p_expected_draft_revision: 9,
    });
  });

  it.each([
    ['P2031', 404, '見つかりません'],
    ['P2033', 409, '他の変更と競合しました'],
    ['P2051', 409, '承認済みのレポートは変更できません'],
    ['P2055', 422, '復元できません'],
  ])('RPC の %s は %i', async (code, status, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'db message' } });
    const response = await POST(request({ expectedDraftRevision: 1 }), params());
    expect(response.status).toBe(status);
    expect((await response.json()).error).toContain(message);
  });

  it('結果の形が不正なら500', async () => {
    mocks.rpc.mockResolvedValue({ data: { restoredVersionNumber: 1 }, error: null });
    expect((await POST(request({ expectedDraftRevision: 1 }), params())).status).toBe(500);
  });
});
