// POST /api/ssbj/reports/[reportId]/status の Route Handler テスト（docs/ssbj-spec.md §13「状態管理と承認ロック」）。
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
const APPROVER_ID = '019890ab-1234-4cde-8f01-23456789ffff';

const request = (body: unknown) =>
  new Request(`http://localhost/api/ssbj/reports/${REPORT_ID}/status`, { method: 'POST', body: JSON.stringify(body) });
const params = (reportId: string = REPORT_ID) => ({ params: Promise.resolve({ reportId }) });

describe('POST /api/ssbj/reports/[reportId]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
  });

  it('未ログインは401、UUIDでないreportIdは404', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    expect((await POST(request({ action: 'submit', expectedDraftRevision: 1 }), params())).status).toBe(401);
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
    expect((await POST(request({ action: 'submit', expectedDraftRevision: 1 }), params('x'))).status).toBe(404);
  });

  it.each([
    [{ action: 'delete', expectedDraftRevision: 1 }, '状態の操作が不正です'],
    [{ action: 'approve', expectedDraftRevision: 'a' }, 'expectedDraftRevision'],
    [{ action: 'submit', expectedDraftRevision: 1, approverUserId: 'not-a-uuid' }, '承認者の指定が不正です'],
    [{ action: 'reopen', expectedDraftRevision: 1, comment: 'あ'.repeat(1001) }, '1000文字以内'],
  ])('入力が不正なら400で RPC を呼ばない（%o）', async (body, message) => {
    const response = await POST(request(body), params());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(message);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('操作者・組織はセッションから決めて RPC に渡し、結果を返す', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'in_review', approverUserId: APPROVER_ID }, error: null });
    const response = await POST(request({
      action: 'submit', expectedDraftRevision: 4, approverUserId: APPROVER_ID, comment: 'お願いします',
      organizationId: 'other-org', actorUserId: 'someone-else',
    }), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'in_review', approverUserId: APPROVER_ID, reviewRequestedByUserId: null, approvedVersionId: null,
      approvedVersionNumber: null,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('change_ssbj_report_status', {
      p_report_id: REPORT_ID,
      p_organization_id: 'org-1',
      p_actor_user_id: 'user-1',
      p_action: 'submit',
      p_expected_draft_revision: 4,
      p_approver_user_id: APPROVER_ID,
      p_comment: 'お願いします',
    });
  });

  it.each([
    ['P2031', 404, 'SSBJレポートが見つかりません'],
    ['P2033', 409, '他の変更と競合しました'],
    ['P2052', 400, '承認者には同じ組織の利用者を指定してください'],
    ['P2053', 403, '承認できるのは、指定された承認者か管理者だけです'],
    ['P2054', 409, 'レビュー中のレポートだけ承認できます'],
    ['P2056', 403, 'レビューを依頼した本人は承認できません'],
    ['P2057', 400, '差戻しの理由を入力してください'],
  ])('RPC の %s は %i', async (code, status, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
    const response = await POST(request({ action: 'approve', expectedDraftRevision: 1 }), params());
    expect(response.status).toBe(status);
    expect((await response.json()).error).toContain(message);
  });

  it('想定外の失敗は500でログに残す（DB のメッセージは返さない）', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal detail' } });
    const response = await POST(request({ action: 'approve', expectedDraftRevision: 1 }), params());
    expect(response.status).toBe(500);
    expect((await response.json()).error).not.toContain('internal detail');
    expect(mocks.log.error).toHaveBeenCalled();
  });
});
