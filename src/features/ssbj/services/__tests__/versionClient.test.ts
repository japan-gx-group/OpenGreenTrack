// saveSsbjReportVersion（保存版作成 API の呼び出し）のテスト。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveSsbjReportVersion } from '../versionClient';

const REPORT_ID = '5b1f0000-1111-4000-8000-000000000001';

const mockFetch = (status: number, body: unknown) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveSsbjReportVersion', () => {
  it('draftRevision を渡して保存版を作り、版番号を返す', async () => {
    const fetchMock = mockFetch(201, { id: 'version-1', versionNumber: 2 });

    await expect(saveSsbjReportVersion(REPORT_ID, 5)).resolves.toEqual({
      id: 'version-1',
      versionNumber: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(`/api/ssbj/reports/${REPORT_ID}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedDraftRevision: 5 }),
    });
  });

  it('元版を指定して新版を作る', async () => {
    const fetchMock = mockFetch(201, { id: 'version-2', versionNumber: 3 });
    await saveSsbjReportVersion(REPORT_ID, 5, 'version-1');
    expect(fetchMock).toHaveBeenCalledWith(`/api/ssbj/reports/${REPORT_ID}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedDraftRevision: 5, sourceVersionId: 'version-1' }),
    });
  });

  it('競合（409）はサーバのメッセージを例外にする', async () => {
    mockFetch(409, { error: '他の変更と競合しました。画面を開き直してから保存し直してください' });

    await expect(saveSsbjReportVersion(REPORT_ID, 5)).rejects.toThrow('他の変更と競合しました');
  });

  it('メッセージの無い失敗は既定の文言にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })));

    await expect(saveSsbjReportVersion(REPORT_ID, 5)).rejects.toThrow('保存版の作成に失敗しました');
  });
});
