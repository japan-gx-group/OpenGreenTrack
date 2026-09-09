// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, focusElement, keyDown, render } from '@/lib/testing/render';
import { HelpModal } from '../HelpModal.client';

// ヘルプモーダルのフォーカス管理のテスト。
// HelpModal は createPortal で body 直下に描画するため、要素は document から探す。

const getDialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const getCloseButton = () =>
  document.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!;
const getFocusables = () =>
  Array.from(getDialog().querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'));

describe('HelpModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('開くと閉じるボタンにフォーカスし、用語検索にはフォーカスしない', () => {
    const { unmount } = render(<HelpModal onClose={() => {}} />);

    expect(document.activeElement).toBe(getCloseButton());
    expect(document.activeElement?.tagName).not.toBe('INPUT');
    unmount();
  });

  it('クイックガイド・FAQ が用語集より先（左）に並ぶ', () => {
    const { unmount } = render(<HelpModal onClose={() => {}} />);

    const headings = Array.from(getDialog().querySelectorAll('h4')).map((h) => h.textContent);
    expect(headings).toEqual(['クイックガイド', 'よくある質問', '用語集']);
    unmount();
  });

  it('末尾の要素で Tab を押すと先頭（閉じるボタン）へ戻る', () => {
    const { unmount } = render(<HelpModal onClose={() => {}} />);

    const focusables = getFocusables();
    const last = focusables[focusables.length - 1]!;
    focusElement(last);
    expect(document.activeElement).toBe(last);

    keyDown(document, 'Tab');
    expect(document.activeElement).toBe(getCloseButton());
    unmount();
  });

  it('先頭（閉じるボタン）で Shift+Tab を押すと末尾の要素へ回る', () => {
    const { unmount } = render(<HelpModal onClose={() => {}} />);

    const focusables = getFocusables();
    const last = focusables[focusables.length - 1]!;
    expect(document.activeElement).toBe(getCloseButton());

    keyDown(document, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
    unmount();
  });

  it('フォーカスがモーダルの外にある状態で Tab を押すと先頭へ引き戻す', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const { unmount } = render(<HelpModal onClose={() => {}} />);

    focusElement(outside);
    expect(document.activeElement).toBe(outside);

    keyDown(document, 'Tab');
    expect(document.activeElement).toBe(getCloseButton());
    unmount();
    outside.remove();
  });

  it('閉じると開く前にフォーカスしていた要素へ戻す', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<HelpModal onClose={() => {}} />);
    expect(document.activeElement).toBe(getCloseButton());

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('Escape キーと閉じるボタンで onClose が呼ばれる', () => {
    const onClose = vi.fn();
    const { unmount } = render(<HelpModal onClose={onClose} />);

    keyDown(document, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    click(getCloseButton());
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
  });
});
