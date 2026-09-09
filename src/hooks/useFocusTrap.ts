'use client';

import { useEffect, type RefObject } from 'react';

/**
 * キーボード操作でフォーカスが当たり得る要素のセレクタ。
 * モーダルの初期フォーカス先の探索と、Tab 循環の端の判定に使う。
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]',
].join(', ');

/**
 * Tab / Shift+Tab のフォーカス移動を containerRef の中に閉じ込める（フォーカストラップ）。
 *
 * モーダルは fixed で画面全体を覆うが、DOM 上は背後のページ要素も残っているため、
 * 何もしないと Tab で背後のサイドバーや本文へフォーカスが抜けてしまう。
 * 末尾の要素で Tab → 先頭へ、先頭で Shift+Tab → 末尾へ回すことで、
 * キーボードだけの利用者がモーダルの中で操作を完結できるようにする。
 *
 * フォーカスがコンテナの外（例: 中の非フォーカス要素をクリックして body に落ちた状態）に
 * あるときに Tab が押された場合も、先頭の要素へ引き戻す。
 *
 * isActive が false の間はリスナーを張らない（isOpen で制御する Modal 向け）。
 */
export const useFocusTrap = (containerRef: RefObject<HTMLElement | null>, isActive = true) => {
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;

      const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
      const active = document.activeElement;

      if (!(active instanceof Node) || !container.contains(active)) {
        firstElement.focus();
        e.preventDefault();
        return;
      }

      if (e.shiftKey) {
        if (active === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else if (active === lastElement) {
        firstElement.focus();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, isActive]);
};
