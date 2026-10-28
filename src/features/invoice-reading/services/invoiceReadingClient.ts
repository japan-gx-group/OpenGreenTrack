// 請求書の AI 読取りの呼び出し（ブラウザから呼ぶ I/O）。保存済みの帳票の ID を POST /api/ai/invoice-reading に送る。
// 回数の上限（429）は、待ってからやり直せるよう Retry-After の秒数を添えて返す（待つかどうかは呼び出し側が決める）。

import type { InvoiceReadingResult } from '../types';

export type InvoiceReadingOutcome =
  | { ok: true; result: InvoiceReadingResult }
  | { ok: false; status: number; message: string; retryAfterSeconds: number | null };

const NETWORK_ERROR_MESSAGE = '通信に失敗しました。時間をおいて再度お試しください';

export const requestInvoiceReading = async (evidenceFileId: string): Promise<InvoiceReadingOutcome> => {
  let response: Response;
  try {
    response = await fetch('/api/ai/invoice-reading', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evidenceFileId }),
    });
  } catch {
    return { ok: false, status: 0, message: NETWORK_ERROR_MESSAGE, retryAfterSeconds: null };
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok && typeof json === 'object' && json !== null) {
    return { ok: true, result: json as InvoiceReadingResult };
  }
  const retryAfter = Number(response.headers.get('Retry-After'));
  return {
    ok: false,
    status: response.status,
    message:
      typeof json === 'object' && json !== null && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : '請求書を読み取れませんでした',
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  };
};
