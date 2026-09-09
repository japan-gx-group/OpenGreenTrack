'use client';

// 画面右上に一定時間だけ出す通知（成功 / 失敗）。
// 前のトーストの消去タイマーが後から表示したトーストを早期に消さないよう、表示のたびにキャンセルする。
// showToast は参照が安定しているので、effect の依存配列に入れても再実行の原因にならない。

import { useCallback, useRef, useState } from 'react';

export type ToastType = 'success' | 'error';
export type ToastState = { message: string; type: ToastType } | null;
export type ShowToast = (message: string, type: ToastType) => void;

const DEFAULT_TOAST_DURATION_MS = 3000;

export interface UseToastOptions {
  /** 表示時間（ms）。長文の結果通知を出す画面は長めにする */
  durationMs?: number;
}

export function useToast({ durationMs = DEFAULT_TOAST_DURATION_MS }: UseToastOptions = {}): {
  toast: ToastState;
  showToast: ShowToast;
} {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback<ShowToast>((message, type) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setToast({ message, type });
    timerRef.current = setTimeout(() => {
      setToast(null);
    }, durationMs);
  }, [durationMs]);

  return { toast, showToast };
}
