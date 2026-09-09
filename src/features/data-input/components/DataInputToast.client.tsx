'use client';

// データ入力画面のトースト。保存や算定の結果を複数行で出すため、画面下からスライドインして
// 長め（10 秒）に表示し、消える直前にフェードアウトする。表示の制御は useToast が持つ。
// 共有の Toast 部品（右上・短時間）とは見た目が違うため別に持つ。

import { CheckCircle2 } from 'lucide-react';

export const DATA_INPUT_TOAST_VISIBLE_MS = 10000;
const TOAST_FADE_OUT_MS = 300;
const TOAST_FADE_OUT_DELAY_SECONDS = (DATA_INPUT_TOAST_VISIBLE_MS - TOAST_FADE_OUT_MS) / 1000;
const DATA_INPUT_TOAST_ANIMATION = [
  'slideInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
  `fadeOutToast 0.3s ease-out ${TOAST_FADE_OUT_DELAY_SECONDS}s forwards`,
].join(', ');

export const DataInputToast = ({ message }: { message: string | null }) => {
  if (!message) return null;

  return (
    <div className="toast-container">
      <div
        className="toast"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          alignItems: 'flex-start',
          animation: DATA_INPUT_TOAST_ANIMATION,
          maxWidth: 'min(720px, calc(100vw - 2rem))',
        }}
      >
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" />
        <span className="min-w-0 whitespace-pre-line break-words">{message}</span>
      </div>
    </div>
  );
};
