import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 請求書の AI 読取りの入口: 保存済みの帳票の ID を受け取り、ログイン中の人のセッションで帳票の行とファイルを読んで
// 読取りに渡す。4MB を超える帳票は AI に送らない。失敗は決まった文と状態コードで返す。

const mocks = vi.hoisted(() => ({
  profile: null as null | { id: string; organizationId: string; role: string },
  evidence: null as null | Record<string, unknown>,
  selectError: null as null | { message: string },
  download: vi.fn(),
  selectedId: null as string | null,
  readInvoice: vi.fn(),
}));

vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: async () => mocks.profile }));
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => ({ warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => {
          mocks.selectedId = id;
          return { maybeSingle: async () => ({ data: mocks.evidence, error: mocks.selectError }) };
        },
      }),
    }),
    storage: { from: () => ({ download: mocks.download }) },
  }),
}));
vi.mock('@/features/invoice-reading/services/readInvoice', () => ({ readInvoice: mocks.readInvoice }));

import { POST } from '../route';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const EVIDENCE_ID = '0b6f1c1e-2f7a-4a39-9d55-7f1d2a3b4c5d';
const EVIDENCE = {
  id: EVIDENCE_ID,
  fileName: '9月分.pdf',
  mimeType: 'application/pdf',
  // PostgREST は bigint を文字列で返すことがあるため、数値に直して渡すことも確かめる。
  sizeBytes: '6',
  convertedFrom: null,
  storagePath: `org-1/activity-evidence/${EVIDENCE_ID}.pdf`,
  createdAt: '2026-10-26T00:00:00Z',
  uploadedBy: 'member-1',
};

const request = (body: unknown) =>
  new NextRequest('http://localhost/api/ai/invoice-reading', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

describe('POST /api/ai/invoice-reading', () => {
  beforeEach(() => {
    mocks.profile = { id: 'member-1', organizationId: 'org-1', role: 'member' };
    mocks.evidence = { ...EVIDENCE };
    mocks.selectError = null;
    mocks.selectedId = null;
    mocks.download.mockReset().mockResolvedValue({ data: new Blob([PDF]), error: null });
    mocks.readInvoice.mockReset();
  });

  it('ログインしていなければ 401（帳票も読取りも呼ばない）', async () => {
    mocks.profile = null;
    const response = await POST(request({ evidenceFileId: EVIDENCE_ID }));
    expect(response.status).toBe(401);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.readInvoice).not.toHaveBeenCalled();
  });

  it('JSON でない・帳票の ID が UUID でなければ 400', async () => {
    for (const body of ['not json', {}, { evidenceFileId: 'abc' }, { evidenceFileId: 1 }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'JSON で evidenceFileId（読み取る帳票）を送信してください' });
    }
    expect(mocks.selectedId).toBeNull();
  });

  it('自組織の帳票が見つからなければ 404（RLS で他の組織の帳票は見えない）', async () => {
    mocks.evidence = null;
    const response = await POST(request({ evidenceFileId: EVIDENCE_ID }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: '帳票が見つかりません' });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('帳票の行を読めなければ 500', async () => {
    mocks.selectError = { message: 'boom' };
    const response = await POST(request({ evidenceFileId: EVIDENCE_ID }));
    expect(response.status).toBe(500);
  });

  it('4MB を超える帳票は AI に送らず 400（ファイルも読まない）', async () => {
    mocks.evidence = { ...EVIDENCE, sizeBytes: String(4 * 1024 * 1024 + 1) };
    const response = await POST(request({ evidenceFileId: EVIDENCE_ID }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: '4MB を超える帳票は AI では読めません（帳票は保存されています）。手で入力してください',
    });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.readInvoice).not.toHaveBeenCalled();
  });

  it('ファイルを読めなければ 500', async () => {
    mocks.download.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const response = await POST(request({ evidenceFileId: EVIDENCE_ID }));
    expect(response.status).toBe(500);
    expect(mocks.readInvoice).not.toHaveBeenCalled();
  });

  it('メンバーも読み取れる。帳票のファイルと行（大きさは数値）を、ログイン中のプロフィールと一緒に渡す', async () => {
    mocks.readInvoice.mockResolvedValue({ ok: true, result: { items: [], warnings: [] } });
    const response = await POST(request({ evidenceFileId: EVIDENCE_ID }));
    expect(response.status).toBe(200);
    expect(mocks.selectedId).toBe(EVIDENCE_ID);
    expect(mocks.download).toHaveBeenCalledWith(EVIDENCE.storagePath);
    expect(mocks.readInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ profile: mocks.profile, file: PDF, evidence: { ...EVIDENCE, sizeBytes: 6 } }),
    );
  });

  it('回数の上限は 429 と Retry-After、設定の不足は 409、それ以外の提供元の失敗は 502 で返す', async () => {
    mocks.readInvoice.mockResolvedValueOnce({ ok: false, code: 'limit_exceeded', message: '上限です', retryAfterSeconds: 42 });
    const limited = await POST(request({ evidenceFileId: EVIDENCE_ID }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('42');
    expect(await limited.json()).toEqual({ error: '上限です' });

    mocks.readInvoice.mockResolvedValueOnce({ ok: false, code: 'model_not_selected', message: 'モデルを選んでください' });
    expect((await POST(request({ evidenceFileId: EVIDENCE_ID }))).status).toBe(409);

    mocks.readInvoice.mockResolvedValueOnce({ ok: false, code: 'overloaded', message: '混み合っています' });
    expect((await POST(request({ evidenceFileId: EVIDENCE_ID }))).status).toBe(502);
  });
});
