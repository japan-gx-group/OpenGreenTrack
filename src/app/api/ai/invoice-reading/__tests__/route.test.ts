import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  profile: null as null | { id: string; organizationId: string; role: string },
  readInvoice: vi.fn(),
}));

vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: async () => mocks.profile }));
vi.mock('@/features/invoice-reading/services/readInvoice', () => ({ readInvoice: mocks.readInvoice }));

import { POST } from '../route';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

const request = (file?: File, headers: Record<string, string> = {}) => {
  const body = new FormData();
  if (file) body.append('file', file);
  return new NextRequest('http://localhost/api/ai/invoice-reading', { method: 'POST', body, headers });
};

describe('POST /api/ai/invoice-reading', () => {
  beforeEach(() => {
    mocks.profile = { id: 'member-1', organizationId: 'org-1', role: 'member' };
    mocks.readInvoice.mockReset();
  });

  it('ログインしていなければ 401（読取りを呼ばない）', async () => {
    mocks.profile = null;
    const response = await POST(request(new File([PDF], 'a.pdf')));
    expect(response.status).toBe(401);
    expect(mocks.readInvoice).not.toHaveBeenCalled();
  });

  it('ファイルが無ければ 400', async () => {
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '請求書のファイル（PDF・PNG・JPEG・WebP）を 1 つ選んでください' });
  });

  it('本文が大きすぎれば、ファイルを読む前に 413', async () => {
    const response = await POST(request(new File([PDF], 'a.pdf'), { 'content-length': String(5 * 1024 * 1024) }));
    expect(response.status).toBe(413);
    expect(mocks.readInvoice).not.toHaveBeenCalled();
  });

  it('メンバーも読み取れる。組織はログイン中のプロフィールのものを使い、ファイル名はそろえて渡す', async () => {
    mocks.readInvoice.mockResolvedValue({ ok: true, result: { items: [], warnings: [] } });
    const response = await POST(request(new File([PDF], ' 9月分\n.pdf ')));
    expect(response.status).toBe(200);
    expect(mocks.readInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ profile: mocks.profile, file: PDF, fileName: '9月分 .pdf' }),
    );
  });

  it('回数の上限は 429 と Retry-After、設定の不足は 409 で返す', async () => {
    mocks.readInvoice.mockResolvedValueOnce({ ok: false, code: 'limit_exceeded', message: '上限です', retryAfterSeconds: 42 });
    const limited = await POST(request(new File([PDF], 'a.pdf')));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('42');
    expect(await limited.json()).toEqual({ error: '上限です' });

    mocks.readInvoice.mockResolvedValueOnce({ ok: false, code: 'model_not_selected', message: 'モデルを選んでください' });
    expect((await POST(request(new File([PDF], 'a.pdf')))).status).toBe(409);

    mocks.readInvoice.mockResolvedValueOnce({ ok: false, code: 'overloaded', message: '混み合っています' });
    expect((await POST(request(new File([PDF], 'a.pdf')))).status).toBe(502);
  });
});
