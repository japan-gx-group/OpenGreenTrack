// createSsbjReportVersion（create_ssbj_report_version RPC の呼び出し）のテスト（docs/ssbj-spec.md §8）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { SsbjReportVersionRpcError, createSsbjReportVersion } from '../versionServer';

const stubSupabase = (rpcResult: { data: unknown; error: { code?: string; message?: string } | null }) => ({
  rpc: vi.fn(async () => rpcResult),
});

describe('createSsbjReportVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RPCの結果をそのまま返す', async () => {
    const supabase = stubSupabase({ data: { id: 'v1', versionNumber: 2 }, error: null });
    mocks.createAdminClient.mockReturnValue(supabase);

    const result = await createSsbjReportVersion({
      reportId: 'report-1',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      expectedDraftRevision: 3,
    });

    expect(result).toEqual({ id: 'v1', versionNumber: 2 });
    expect(supabase.rpc).toHaveBeenCalledWith('create_ssbj_report_version', {
      p_report_id: 'report-1',
      p_organization_id: 'org-1',
      p_actor_user_id: 'user-1',
      p_expected_draft_revision: 3,
      p_note: null,
      p_source_version_id: null,
    });
  });

  it('RPCエラーはSsbjReportVersionRpcErrorとしてcodeを保持する', async () => {
    const supabase = stubSupabase({ data: null, error: { code: 'P2033', message: '競合' } });
    mocks.createAdminClient.mockReturnValue(supabase);

    await expect(
      createSsbjReportVersion({
        reportId: 'report-1',
        organizationId: 'org-1',
        actorUserId: 'user-1',
        expectedDraftRevision: 1,
      }),
    ).rejects.toMatchObject(
      new SsbjReportVersionRpcError('競合', 'P2033'),
    );
  });

  it('戻り値の形が不正なら例外を投げる', async () => {
    const supabase = stubSupabase({ data: { id: 'v1' }, error: null });
    mocks.createAdminClient.mockReturnValue(supabase);

    await expect(
      createSsbjReportVersion({
        reportId: 'report-1',
        organizationId: 'org-1',
        actorUserId: 'user-1',
        expectedDraftRevision: 1,
      }),
    ).rejects.toThrow('保存版の作成結果が不正です');
  });
});
