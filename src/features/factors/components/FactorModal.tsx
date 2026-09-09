import React, { useEffect, useId, useRef } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

type FactorModalProps = {
  title: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
};

// 排出係数管理画面のモーダル共通シェル（係数詳細・更新履歴・ソース詳細・登録/編集フォームが使う）。
// 呼び出し側が「開いている間だけマウントする」形で表示を制御する前提。
// 共有の Modal.client.tsx と同じく、Escape で閉じる・dialog セマンティクス・
// 開閉時のフォーカス移動・Tab の閉じ込め・背景スクロールのロックを備える。
export const FactorModal = ({ title, icon: Icon, onClose, children, maxWidth = '560px' }: FactorModalProps) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const previousBodyOverflowRef = useRef<string | null>(null);

  useFocusTrap(dialogRef);

  // Escape で閉じる。ただし IME 変換中の Esc は「変換の取り消し」であって閉じる意図ではないため無視する
  // （係数名称など日本語入力欄を持つフォームで、変換を取り消しただけで入力内容ごと消えるのを防ぐ）。
  // isComposing に加えて keyCode 229 も見るのは、変換確定直後の keydown を
  // isComposing=false・keyCode=229 で届けるブラウザがあるため。
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.isComposing || e.keyCode === 229) return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 開いたら閉じるボタンへフォーカスを移し、背後のページにフォーカスを残さない。
  // 閉じたら開く前の要素（一覧の詳細ボタン・編集ボタンなど）へ戻す。
  // 背景スクロールは開いている間だけ止め、開く前の overflow の値へ戻す。
  // onClose の参照が変わるたびにフォーカスが飛ばないよう、Escape の effect とは分けてマウント時に一度だけ動かす。
  useEffect(() => {
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousBodyOverflowRef.current ?? '';
      previousBodyOverflowRef.current = null;

      // body は「フォーカスを失った状態」の受け皿でしかないため復帰先として扱わない
      const previous = previousActiveElementRef.current;
      if (previous && previous !== document.body && previous.isConnected) {
        previous.focus();
      }
      previousActiveElementRef.current = null;
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        // 共有 .modal-overlay（globals.css）と同じ黒スクリム。トークン化対象外（R5例外）
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 共有 .modal-overlay と同じ 1000。モバイルのサイドバー層（バックドロップ 900 /
        // ドロワー 950 / ハンバーガー 960）より上に置かないと、モーダルを開いたまま
        // ハンバーガーが押せてドロワーがモーダルの上に開いてしまう
        zIndex: 1000,
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          backgroundColor: 'var(--color-bg-card)',
          padding: '2rem',
          borderRadius: 'var(--radius-lg)',
          width: '90%',
          maxWidth,
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          animation: 'modalScale 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2 text-primary">
            {Icon && <Icon size={22} />}
            <h3 id={titleId} className="text-lg font-serif font-semibold" style={{ margin: 0 }}>{title}</h3>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-main"
            aria-label="閉じる"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
