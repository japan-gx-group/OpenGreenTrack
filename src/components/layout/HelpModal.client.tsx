'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ChevronDown, Download, HelpCircle } from 'lucide-react';
import clsx from 'clsx';
import { GLOSSARY_TERMS, FAQ_ITEMS, QUICK_GUIDE_TEXT } from './helpContent';
import { downloadBlob } from '@/lib/files/download';
import { useFocusTrap } from '@/hooks/useFocusTrap';

type HelpModalProps = {
  onClose: () => void;
};

// 呼び出し側（Sidebar）で isHelpOpen && <HelpModal /> のようにマウント制御する。
// これによりモーダルを閉じるたびにコンポーネントがアンマウントされ、
// 検索文字列やFAQの開閉状態は次回オープン時に自然と初期化される。
// 描画は createPortal で body 直下へ逃がす。祖先（サイドバー等）のスタッキング
// コンテキストに閉じ込められると、z-index を上げてもメインコンテンツが
// モーダルより手前に描画されてしまうため。
export const HelpModal = ({ onClose }: HelpModalProps) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousBodyOverflowRef = useRef<string | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [openFaqIndexes, setOpenFaqIndexes] = useState<Set<number>>(new Set());

  // Tab / Shift+Tab のフォーカスをモーダル内に閉じ込める（共有の Modal.tsx と同じ hook）
  useFocusTrap(dialogRef);

  // Escキーで閉じる + 背景スクロールを止める（既存のsrc/components/ui/Modal.tsxと同じ挙動）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    // 空文字で戻すと、呼び出し元が別途 body に設定していた overflow を巻き戻してしまう。
    // 開く前の値を控えて、そこへ戻す。
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflowRef.current ?? '';
      previousBodyOverflowRef.current = null;
    };
  }, [onClose]);

  // 開いた直後のフォーカスは先頭の要素（閉じるボタン）へ当てる（共有の Modal.tsx と同じ挙動）。
  // 用語検索に当てると「用語集が主」という誤った位置づけになるため、そこには置かない。
  // 閉じたときは開く前にフォーカスしていた要素（サイドバーのヘルプボタン）へ戻す。
  // 呼び出し側の再レンダーで onClose の参照が変わってもフォーカスが飛ばないよう、
  // 上の effect とは分けてマウント時に一度だけ動かす。
  useEffect(() => {
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      const previous = previousActiveElementRef.current;
      if (previous && previous !== document.body && previous.isConnected) {
        previous.focus();
      }
      previousActiveElementRef.current = null;
    };
  }, []);

  const query = searchQuery.trim().toLowerCase();
  const filteredTerms = query
    ? GLOSSARY_TERMS.filter(
        ({ term, definition }) =>
          term.toLowerCase().includes(query) || definition.toLowerCase().includes(query)
      )
    : GLOSSARY_TERMS;

  const toggleFaq = (index: number) => {
    setOpenFaqIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // クイックガイドをテキスト（.txt）でその場ダウンロードさせる。
  const handleDownloadGuide = () => {
    const blob = new Blob([QUICK_GUIDE_TEXT], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, 'OpenGreenTrack_クイックガイド.txt');
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        // isolate で新しいスタッキングコンテキストを作り、親のbackdrop-blurとの合成で
        // パネルの不透明な背景が透けて見える問題（実機確認で発覚）を防ぐ。
        // 背景色もクラスに加えてインラインで明示し、確実に不透明な面にする。
        className="isolate bg-bg-card rounded-lg border border-border shadow-xl w-full max-w-3xl overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh', backgroundColor: 'var(--color-bg-card)' }}
      >
        <div
          className="bg-bg-card flex justify-between items-center border-b border-border py-5 px-6 flex-shrink-0"
        >
          <h3
            id="help-modal-title"
            className="font-serif font-semibold text-lg text-text-heading m-0 flex items-center gap-2"
          >
            <HelpCircle size={20} className="text-primary" />
            ヘルプ＆FAQ
          </h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-text-muted hover:text-text-main transition-colors p-1 rounded-md hover:bg-border-light bg-transparent border-none cursor-pointer flex items-center justify-center"
          >
            <X size={20} />
          </button>
        </div>

        {/*
          grid/flexの入れ子でoverflow-y-autoを効かせるには、
          各コンテナに min-h-0 が必要（無いと内容量に応じて高さが伸び、スクロールされず全体がはみ出す）。
        */}
        <div className="bg-bg-card grid grid-cols-1 md:grid-cols-2 flex-1 min-h-0 overflow-hidden">
          {/* 左カラム（主）: クイックガイド + FAQ。ヘルプを開く主目的は操作の解決なので先頭に置く */}
          <div className="flex flex-col min-h-0 p-6 border-b md:border-b-0 md:border-r border-border overflow-y-auto">
            <h4 className="font-serif font-semibold text-sm text-text-heading mb-3">クイックガイド</h4>
            <button
              type="button"
              onClick={handleDownloadGuide}
              className="gt-btn w-full justify-center"
            >
              <Download size={16} />
              クイックガイド（テキスト）をダウンロード
            </button>
            <p className="text-xs text-text-muted mt-2 mb-6">
              ※ テキスト形式（.txt）でダウンロードします。
            </p>

            <h4 className="font-serif font-semibold text-sm text-text-heading mb-3">よくある質問</h4>
            <div className="flex flex-col gap-2">
              {FAQ_ITEMS.map((item, index) => {
                const isExpanded = openFaqIndexes.has(index);
                return (
                  <div key={item.question} className="border border-border rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleFaq(index)}
                      aria-expanded={isExpanded}
                      className="w-full flex items-center justify-between gap-2 py-3 px-4 text-left text-sm font-medium text-text-main bg-transparent border-none cursor-pointer"
                    >
                      <span>{item.question}</span>
                      <ChevronDown
                        size={16}
                        className={clsx('text-text-muted transition-transform flex-shrink-0', {
                          'rotate-180': isExpanded,
                        })}
                      />
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 text-sm text-text-muted leading-relaxed">{item.answer}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右カラム（副）: 用語集（検索付き） */}
          <div className="flex flex-col min-h-0 p-6 overflow-hidden">
            <h4 className="font-serif font-semibold text-sm text-text-heading mb-3 flex-shrink-0">用語集</h4>

            <div className="relative flex items-center mb-3 flex-shrink-0">
              <Search size={16} className="absolute left-3 text-text-muted" />
              <input
                type="text"
                placeholder="用語を検索..."
                className="gt-field"
                style={{ paddingLeft: '2.5rem' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
              {filteredTerms.length === 0 ? (
                <p className="text-sm text-text-muted">該当する用語が見つかりません。</p>
              ) : (
                filteredTerms.map(({ term, definition }) => (
                  <div key={term} className="pb-3 border-b border-border-light last:border-b-0 last:pb-0">
                    <p className="font-semibold text-sm text-text-main m-0">{term}</p>
                    <p className="text-sm text-text-muted mt-1 m-0">{definition}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
