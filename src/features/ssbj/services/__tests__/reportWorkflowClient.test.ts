import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeSsbjReportStatus, restoreSsbjReportVersion } from '../reportWorkflowClient';

// 画面から API を呼ぶ処理: 送る内容と、失敗したときにサーバのメッセージを例外にすることを検証する。
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => fetchMock.mockReset());

describe('changeSsbjReportStatus', () => {
  it('状態の操作を送り、結果を返す', async () => {
    respond(200, { status: 'approved', approverUserId: 'u', approvedVersionId: 'v', approvedVersionNumber: 2 });
    await expect(changeSsbjReportStatus('report 1', { action: 'approve', expectedDraftRevision: 5 }))
      .resolves.toMatchObject({ status: 'approved', approvedVersionNumber: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ssbj/reports/report%201/status');
    expect(JSON.parse(init.body)).toEqual({ action: 'approve', expectedDraftRevision: 5 });
  });

  it('失敗したときはサーバのメッセージを例外にする', async () => {
    respond(403, { error: '承認できるのは、指定された承認者か管理者だけです' });
    await expect(changeSsbjReportStatus('r', { action: 'approve', expectedDraftRevision: 1 }))
      .rejects.toThrow('承認できるのは、指定された承認者か管理者だけです');
  });
});

describe('restoreSsbjReportVersion', () => {
  it('版と、画面が持っている版数を送る', async () => {
    respond(200, { restoredVersionNumber: 1, backupVersionId: 'b', backupVersionNumber: 3, draftRevision: 8 });
    await restoreSsbjReportVersion('r', 'v', 7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ssbj/reports/r/versions/v/restore');
    expect(JSON.parse(init.body)).toEqual({ expectedDraftRevision: 7 });
  });

  it('本文が読めない失敗は既定のメッセージ', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));
    await expect(restoreSsbjReportVersion('r', 'v', 1)).rejects.toThrow('保存版の復元に失敗しました');
  });
});
