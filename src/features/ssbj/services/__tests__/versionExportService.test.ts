// getSsbjApprovedVersion（承認した保存版の API の呼び出し。閲覧者が読む経路）のテスト。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fictionalVersion } from '../../__fixtures__/fictionalReport';
import { getSsbjApprovedVersion } from '../versionExportService';

const REPORT_ID = fictionalVersion.reportId;

const mockFetch = (status: number, body: unknown) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSsbjApprovedVersion', () => {
  it('承認した保存版の API を呼び、返った版をそのまま返す', async () => {
    const version = {
      id: fictionalVersion.id, reportId: REPORT_ID, versionNumber: 1, createdAt: fictionalVersion.createdAt,
      note: '承認時の保存版', sourceVersionId: null, createdByUserId: null, creatorName: '不明', snapshot: fictionalVersion.snapshot,
    };
    const fetchMock = mockFetch(200, version);
    await expect(getSsbjApprovedVersion(REPORT_ID)).resolves.toEqual(version);
    expect(fetchMock).toHaveBeenCalledWith(`/api/ssbj/reports/${REPORT_ID}/approved-version`);
  });

  it('見つからない（404）はサーバのメッセージを例外にする', async () => {
    mockFetch(404, { error: '承認した保存版が見つかりません' });
    await expect(getSsbjApprovedVersion(REPORT_ID)).rejects.toThrow('承認した保存版が見つかりません');
  });

  it('メッセージの無い失敗・形の不正な応答は既定の文言にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })));
    await expect(getSsbjApprovedVersion(REPORT_ID)).rejects.toThrow('承認した保存版の取得に失敗しました');
    mockFetch(200, { id: fictionalVersion.id });
    await expect(getSsbjApprovedVersion(REPORT_ID)).rejects.toThrow('承認した保存版の取得に失敗しました');
  });
});
