// 提供元のテストで共有する fetch のモック。呼ばれた URL・ヘッダを記録し、決めた応答を順に返す。

import { vi } from 'vitest';

export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  init: RequestInit;
}

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const installFetchMock = (responses: Array<Response | Error>) => {
  const requests: RecordedRequest[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      init,
    });
    const next = queue.shift();
    if (!next) throw new Error('no more mocked responses');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
};
