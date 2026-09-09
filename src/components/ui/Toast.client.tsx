'use client';

// 画面右上に一定時間だけ出す通知。表示の制御は useToast（src/hooks/useToast.ts）が持ち、
// ここは見た目だけを担当する。toast が null のときは何も描画しない。

import { AlertCircle, CheckCircle } from 'lucide-react';
import type { ToastState } from '@/hooks/useToast';

export const Toast = ({ toast }: { toast: ToastState }) => {
  if (!toast) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        // 共通 Modal（z-[9999]）を開いたまま出るエラートースト（削除失敗など）が隠れないよう、モーダルより手前に置く。
        zIndex: 10000,
        boxShadow: 'var(--shadow-md)',
        animation: 'slideIn 0.2s ease-out'
      }}
      className={`flex items-center gap-3 px-6 py-4 rounded-md border ${
        toast.type === 'success' ? 'bg-primary-light border-success' : 'bg-danger-light border-danger'
      }`}
    >
      {toast.type === 'success' ? (
        <CheckCircle size={20} className="text-success" />
      ) : (
        <AlertCircle size={20} className="text-danger" />
      )}
      <span className="text-sm font-semibold text-text-main">{toast.message}</span>
    </div>
  );
};
