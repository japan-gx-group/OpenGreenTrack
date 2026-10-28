'use client';

// 請求書の AI 読取りの状態（ファイルを選ぶ → 送信の確認 → 送信中 → 結果 / エラー）。
// 送る前に共通の確認ダイアログを出すため、ファイルを選んだだけでは送らない（confirm で初めて送る）。
// ファイルの大きさ・種類はサーバと共通の入口でも確かめる。ここでは送る前に分かるものを先に断るだけ。

import { useCallback, useRef, useState } from 'react';
import {
  INVOICE_FILE_ACCEPT,
  MAX_INVOICE_FILE_BYTES,
  type InvoiceReadingResult,
} from '../types';

export type InvoiceReadingPhase = 'idle' | 'confirming' | 'sending' | 'done' | 'error';

interface InvoiceReadingState {
  phase: InvoiceReadingPhase;
  file: File | null;
  result: InvoiceReadingResult | null;
  error: string | null;
}

const INITIAL_STATE: InvoiceReadingState = { phase: 'idle', file: null, result: null, error: null };

const ACCEPTED_TYPES = INVOICE_FILE_ACCEPT.split(',');
const NETWORK_ERROR_MESSAGE = '通信に失敗しました。時間をおいて再度お試しください';

/** 送る前に断る理由。送れるなら null */
export const invoiceFileProblem = (file: File): string | null => {
  if (file.size === 0) return 'ファイルが空です';
  if (file.size > MAX_INVOICE_FILE_BYTES) return 'ファイルが大きすぎます。4MB 以下にしてください';
  // 種類が空（拡張子から判定できない）のときは、サーバが先頭のバイトで確かめるので送ってよい。
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) return 'PDF・PNG・JPEG・WebP のファイルを選んでください';
  return null;
};

export const useInvoiceReading = () => {
  const [state, setState] = useState<InvoiceReadingState>(INITIAL_STATE);
  // 送信中に結果を閉じた・別のファイルを選んだときに、古い応答で画面を上書きしない。
  const requestIdRef = useRef(0);

  const selectFile = useCallback((file: File) => {
    const problem = invoiceFileProblem(file);
    setState(
      problem
        ? { phase: 'error', file: null, result: null, error: problem }
        : { phase: 'confirming', file, result: null, error: null },
    );
  }, []);

  const cancel = useCallback(() => {
    requestIdRef.current += 1;
    setState(INITIAL_STATE);
  }, []);

  const confirm = useCallback(async () => {
    const file = state.file;
    if (!file) return;
    const requestId = (requestIdRef.current += 1);
    setState({ phase: 'sending', file, result: null, error: null });

    const body = new FormData();
    body.append('file', file);
    let next: InvoiceReadingState;
    try {
      const response = await fetch('/api/ai/invoice-reading', { method: 'POST', body });
      const json: unknown = await response.json().catch(() => null);
      if (response.ok && typeof json === 'object' && json !== null) {
        next = { phase: 'done', file, result: json as InvoiceReadingResult, error: null };
      } else {
        const message =
          typeof json === 'object' && json !== null && typeof (json as { error?: unknown }).error === 'string'
            ? (json as { error: string }).error
            : '請求書を読み取れませんでした';
        next = { phase: 'error', file: null, result: null, error: message };
      }
    } catch {
      next = { phase: 'error', file: null, result: null, error: NETWORK_ERROR_MESSAGE };
    }
    if (requestIdRef.current === requestId) setState(next);
  }, [state.file]);

  return { ...state, selectFile, cancel, confirm, reset: cancel };
};
