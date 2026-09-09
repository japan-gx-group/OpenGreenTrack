'use client';

import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { FOCUSABLE_SELECTOR, useFocusTrap } from '@/hooks/useFocusTrap';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * 閉じたあとのフォーカス復帰先（任意）。
   * 通常は「開く直前にフォーカスしていた要素」へ戻すが、行内ドロップダウンのメニュー項目から
   * 開く場合はトリガーがメニューごとアンマウントされ activeElement が body になってしまう。
   * そのようなケースだけ、呼び出し側から永続する要素（例: ⋮ ボタン）を渡してもらう。
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

const sizeWidths = {
  sm: '380px',
  md: '448px',
  lg: '560px',
  xl: '680px',
};

export const Modal = ({ isOpen, onClose, title, children, size, returnFocusRef }: ModalProps) => {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const previousBodyOverflowRef = useRef<string | null>(null);

  // Tab / Shift+Tab のフォーカス閉じ込めは HelpModal と共通の hook に寄せる
  useFocusTrap(modalRef, isOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // フォールバック先は「開いた時点」の値で確定させる。呼び出し側は開く操作の中で
    // このrefを差し替えるため、cleanup時に読むと次の操作の値を拾ってしまう。
    const returnFocusTarget = returnFocusRef?.current ?? null;
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // Prevent background scrolling

    // Auto-focus the close button or first element on open
    const timer = setTimeout(() => {
      if (modalRef.current) {
        modalRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousBodyOverflowRef.current ?? '';
      previousBodyOverflowRef.current = null;

      // 開く直前の要素へ戻すのが基本。body は「フォーカスを失った状態」の受け皿でしかないため
      // 復帰先として扱わず、その場合だけ returnFocusRef へフォールバックする。
      const previous = previousActiveElementRef.current;
      if (previous && previous !== document.body && previous.isConnected) {
        previous.focus();
      } else if (returnFocusTarget?.isConnected) {
        returnFocusTarget.focus();
      }
      previousActiveElementRef.current = null;
    };
    // returnFocusRef は useRef 由来の安定した参照を想定（毎レンダー生成すると復帰処理が誤発火する）
  }, [isOpen, returnFocusRef]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      // 中央寄せは items-center ではなくパネル側の m-auto で行う。
      // overflow-y-auto なコンテナで items-center を使うと、子がコンテナより高いとき
      // はみ出しが上下に分配され、上側は scrollTop を負にできず到達不能になるため。
      className="fixed inset-0 z-[9999] flex justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-sm transition-opacity"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-bg-card rounded-lg shadow-xl w-full overflow-hidden flex flex-col m-auto max-h-[calc(100dvh-2rem)]"
        style={{ maxWidth: sizeWidths[size || 'md'] }}
      >
        <div className="flex justify-between items-center border-b border-border py-6 px-8 shrink-0">
          <h3 id={titleId} className="font-bold text-lg text-text-main m-0">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-text-muted hover:text-text-main transition-colors p-1 rounded-md hover:bg-border-light bg-transparent border-none cursor-pointer flex items-center justify-center"
          >
            <X size={20} />
          </button>
        </div>

        <div className="py-9 px-8 min-h-0 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};
