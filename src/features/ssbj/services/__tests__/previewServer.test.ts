// 作業中の内容のプレビュー（サーバ側）のテスト。組み立ては RPC preview_ssbj_report に任せ、
// 組織違い・存在しないレポート（P2031）は null にすることを確かめる。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fictionalSnapshot } from '../../__fixtures__/fictionalReport';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { previewSsbjReport } from '../previewServer';

const params = { reportId: fictionalSnapshot.report.id, organizationId: fictionalSnapshot.report.organizationId };

describe('previewSsbjReport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('セッションの組織を RPC に渡し、作業中の版数とスナップショットを返す', async () => {
    mocks.rpc.mockResolvedValue({ data: { draftRevision: 7, snapshot: fictionalSnapshot }, error: null });
    await expect(previewSsbjReport(params)).resolves.toEqual({ draftRevision: 7, snapshot: fictionalSnapshot });
    expect(mocks.rpc).toHaveBeenCalledWith('preview_ssbj_report', {
      p_report_id: params.reportId,
      p_organization_id: params.organizationId,
    });
  });

  it('レポートが無い・組織が違う（P2031）なら null', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P2031', message: 'not found' } });
    await expect(previewSsbjReport(params)).resolves.toBeNull();
  });

  it('それ以外の失敗と、形の不正な結果は例外', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    await expect(previewSsbjReport(params)).rejects.toThrow('プレビューの組み立てに失敗しました');
    mocks.rpc.mockResolvedValue({ data: { snapshot: fictionalSnapshot }, error: null });
    await expect(previewSsbjReport(params)).rejects.toThrow('プレビューの組み立て結果が不正です');
  });
});
