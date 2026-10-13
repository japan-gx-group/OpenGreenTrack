// POST /api/ssbj/reports/[reportId]/ogt-adoption の Route Handler テスト（T08b）。
// 入力検証・認証ガード・採用失敗の理由の HTTP ステータスへの変換と、ボディに紛れ込ませた値や組織を
// 使わないこと（改ざん防止）を検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guardSsbjRole: vi.fn(),
  getCurrentProfile: vi.fn(),
  adoptOgtCandidates: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: mocks.getCurrentProfile }));
vi.mock('@/lib/logging/requestLogger', () => ({ getRequestLogger: vi.fn(async () => mocks.log) }));
vi.mock('@/features/ssbj/services/ogtAdoptionServer', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/ssbj/services/ogtAdoptionServer')>()),
  adoptOgtCandidates: mocks.adoptOgtCandidates,
}));

import { SsbjOgtAdoptionError } from '@/features/ssbj/services/ogtAdoptionServer';
vi.mock('@/features/ssbj/services/roleServer', () => ({ guardSsbjRole: mocks.guardSsbjRole }));

import { POST } from '../route';

const REPORT_ID = '019890ab-1234-4cde-8f01-23456789abcd';
const FINGERPRINT = '0123456789abcdef';

const request = (body: unknown) =>
  new Request(`http://localhost/api/ssbj/reports/${REPORT_ID}/ogt-adoption`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const params = (reportId: string = REPORT_ID) => ({ params: Promise.resolve({ reportId }) });

describe('POST /api/ssbj/reports/[reportId]/ogt-adoption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ id: 'user-1', organizationId: 'org-1' });
    mocks.guardSsbjRole.mockResolvedValue(null);
    mocks.adoptOgtCandidates.mockResolvedValue({ adoptedAt: '2025-06-03T02:00:00+00:00' });
  });

  it('未ログインは401', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null);
    const response = await POST(request({ expectedFingerprint: FINGERPRINT }), params());
    expect(response.status).toBe(401);
    expect(mocks.adoptOgtCandidates).not.toHaveBeenCalled();
  });

  it('UUIDでないreportIdは404', async () => {
    const response = await POST(request({ expectedFingerprint: FINGERPRINT }), params('not-a-uuid'));
    expect(response.status).toBe(404);
  });

  it.each([
    ['JSON でない', 'not-json'],
    ['指紋が無い', {}],
    ['指紋の形式が違う', { expectedFingerprint: 'xyz' }],
  ])('%s と400', async (_, body) => {
    const response = await POST(request(body), params());
    expect(response.status).toBe(400);
    expect(mocks.adoptOgtCandidates).not.toHaveBeenCalled();
  });

  it('採用できたら201。組織と利用者はセッションから取り、ボディに入れた値や組織は使わない', async () => {
    const response = await POST(
      request({
        expectedFingerprint: FINGERPRINT,
        organizationId: 'attacker-org',
        candidates: [{ scope: 1, value: { state: 'answered', value: '0' } }],
      }),
      params(),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ adoptedAt: '2025-06-03T02:00:00+00:00' });
    expect(mocks.adoptOgtCandidates).toHaveBeenCalledWith({
      reportId: REPORT_ID,
      organizationId: 'org-1',
      actorUserId: 'user-1',
      expectedFingerprint: FINGERPRINT,
    });
  });

  it('レポートが見つからなければ404、OGT の値が表示から変わっていれば409', async () => {
    mocks.adoptOgtCandidates.mockRejectedValueOnce(new SsbjOgtAdoptionError('report_not_found', '見つかりません'));
    expect((await POST(request({ expectedFingerprint: FINGERPRINT }), params())).status).toBe(404);
    mocks.adoptOgtCandidates.mockRejectedValueOnce(new SsbjOgtAdoptionError('candidates_changed', '変わりました'));
    const response = await POST(request({ expectedFingerprint: FINGERPRINT }), params());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '変わりました' });
  });

  it('想定外の失敗は500で、ログに残す', async () => {
    mocks.adoptOgtCandidates.mockRejectedValueOnce(new Error('boom'));
    const response = await POST(request({ expectedFingerprint: FINGERPRINT }), params());
    expect(response.status).toBe(500);
    expect(mocks.log.error).toHaveBeenCalled();
  });
  it('SSBJ のロールが許さなければ 403 で、service_role の処理を呼ばない（docs/authorization-matrix.md §2.2）', async () => {
    mocks.guardSsbjRole.mockResolvedValue({ status: 403, error: 'SSBJ のロールが閲覧者のため、この操作はできません' });
    const response = await POST(request({ expectedFingerprint: '0123456789abcdef' }), params());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('閲覧者のため');
    expect(mocks.guardSsbjRole).toHaveBeenCalledWith({ id: 'user-1', organizationId: 'org-1' }, 'edit', expect.any(Function));
    expect(mocks.adoptOgtCandidates).not.toHaveBeenCalled();
  });

  it('SSBJ のロールを確かめられなければ 500（確かめないまま進めない）', async () => {
    mocks.guardSsbjRole.mockResolvedValue({ status: 500, error: 'サーバー内部エラーが発生しました' });
    expect((await POST(request({ expectedFingerprint: '0123456789abcdef' }), params())).status).toBe(500);
    expect(mocks.adoptOgtCandidates).not.toHaveBeenCalled();
  });
});
