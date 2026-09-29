// POST /api/ssbj/reports/[reportId]/versions の Route Handler テスト（docs/ssbj-spec.md §8）。
// 入力検証・認証ガード・RPC エラーコード（P2031 / P2033）のマッピングを検証する。

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

import { SSBJ_VERSION_SQLSTATE } from '@/features/ssbj/services/versionServer';
import { POST } from '../route';

const REPORT_ID = '019890ab-1234-4cde-8f01-23456789abcd';

const request = (body: unknown) =>
  new Request(`http://localhost/api/ssbj/reports/${REPORT_ID}/versions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

const params = (reportId: string = REPORT_ID) => ({ params: Promise.resolve({ reportId }) });

const stubSupabase = (rpcResult: { data: unknown; error: { code?: string; message?: string } | null }) => ({
  rpc: vi.fn(async () => rpcResult),
});

describe('POST /api/ssbj/reports/[reportId]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    const response = await POST(request({ expectedDraftRevision: 1 }), params());
    expect(response.status).toBe(401);
  });

  it('UUIDでないreportIdは404', async () => {
    const response = await POST(request({ expectedDraftRevision: 1 }), params('not-a-uuid'));
    expect(response.status).toBe(404);
  });

  it('expectedDraftRevisionが数値でないと400', async () => {
    const response = await POST(request({ expectedDraftRevision: 'a' }), params());
    expect(response.status).toBe(400);
  });

  it('sourceVersionIdがUUIDでないと400', async () => {
    const response = await POST(
      request({ expectedDraftRevision: 1, sourceVersionId: 'not-a-uuid' }),
      params(),
    );
    expect(response.status).toBe(400);
  });

  it('レポートが見つからない（P2031）は404', async () => {
    const supabase = stubSupabase({
      data: null,
      error: { code: SSBJ_VERSION_SQLSTATE.reportInvalid, message: 'not found' },
    });
    mocks.createAdminClient.mockReturnValue(supabase);

    const response = await POST(request({ expectedDraftRevision: 1 }), params());
    expect(response.status).toBe(404);
  });

  it('draftRevisionが競合（P2033）は409', async () => {
    const supabase = stubSupabase({
      data: null,
      error: { code: SSBJ_VERSION_SQLSTATE.draftRevisionConflict, message: 'conflict' },
    });
    mocks.createAdminClient.mockReturnValue(supabase);

    const response = await POST(request({ expectedDraftRevision: 1 }), params());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('競合しました');
  });

  it('正常系: 自組織スコープでRPCを呼び201を返す', async () => {
    const supabase = stubSupabase({
      data: { id: 'version-1', versionNumber: 1 },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue(supabase);

    const response = await POST(
      request({ expectedDraftRevision: 1, note: 'メモ' }),
      params(),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ id: 'version-1', versionNumber: 1 });
    expect(supabase.rpc).toHaveBeenCalledWith('create_ssbj_report_version', {
      p_report_id: REPORT_ID,
      p_organization_id: 'org-1',
      p_actor_user_id: 'user-1',
      p_expected_draft_revision: 1,
      p_note: 'メモ',
      p_source_version_id: null,
    });
  });

  it('元版を指定した場合も自組織スコープでRPCを呼ぶ', async () => {
    const sourceVersionId = '019890ab-1234-4cde-8f01-23456789abce';
    const supabase = stubSupabase({ data: { id: 'version-2', versionNumber: 2 }, error: null });
    mocks.createAdminClient.mockReturnValue(supabase);
    const response = await POST(request({ expectedDraftRevision: 1, sourceVersionId }), params());
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith('create_ssbj_report_version', expect.objectContaining({
      p_organization_id: 'org-1',
      p_source_version_id: sourceVersionId,
    }));
  });
});
