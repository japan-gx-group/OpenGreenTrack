// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, focusElement, keyDown, render } from '@/lib/testing/render';
import { Modal } from '../Modal.client';

// Modal の基本挙動のテスト。
// レンダリングは src/lib/testing/render.tsx の軽量ヘルパーを使う。

describe('Modal', () => {
  afterEach(() => {
    // 各テストが body 直下へマウントするため、残骸と body スタイルを毎回リセットする
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('isOpen=false のときは何も描画しない', () => {
    const { container, unmount } = render(
      <Modal isOpen={false} onClose={() => {}} title="非表示モーダル">
        <p>本文</p>
      </Modal>,
    );

    expect(container.firstChild).toBeNull();
    unmount();
  });

  it('isOpen=true のときタイトルと本文を描画し、dialog がタイトルと紐づく', () => {
    const { container, unmount } = render(
      <Modal isOpen onClose={() => {}} title="拠点を追加">
        <p>本文コンテンツ</p>
      </Modal>,
    );

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    const heading = container.querySelector('h3');
    expect(heading?.textContent).toBe('拠点を追加');
    // aria-labelledby がタイトル見出しの id を指していること（スクリーンリーダー向け）
    expect(dialog?.getAttribute('aria-labelledby')).toBe(heading?.id);

    expect(container.textContent).toContain('本文コンテンツ');
    unmount();
  });

  it('閉じるボタンのクリックで onClose が呼ばれる', () => {
    const onClose = vi.fn();
    const { container, unmount } = render(
      <Modal isOpen onClose={onClose} title="確認">
        <p>本文</p>
      </Modal>,
    );

    const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]');
    expect(closeButton).not.toBeNull();
    click(closeButton!);

    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('Escape キーで onClose が呼ばれる', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal isOpen onClose={onClose} title="確認">
        <p>本文</p>
      </Modal>,
    );

    // Modal は document へ keydown リスナーを張るため document に向けて発火する
    keyDown(document, 'Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('オーバーレイのクリックで onClose が呼ばれ、パネル内クリックでは呼ばれない', () => {
    const onClose = vi.fn();
    const { container, unmount } = render(
      <Modal isOpen onClose={onClose} title="確認">
        <p>本文</p>
      </Modal>,
    );

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    const overlay = container.firstElementChild as HTMLElement;
    click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('開いている間は body スクロールをロックし、閉じると元の値へ戻す', () => {
    document.body.style.overflow = 'auto';

    const { rerender, unmount } = render(
      <Modal isOpen onClose={() => {}} title="スクロールロック">
        <p>本文</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal isOpen={false} onClose={() => {}} title="スクロールロック">
        <p>本文</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('auto');
    unmount();
  });

  it('アンマウント時にも body スクロールロックを解除する', () => {
    document.body.style.overflow = 'scroll';

    const { unmount } = render(
      <Modal isOpen onClose={() => {}} title="スクロールロック">
        <p>本文</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('Tab / Shift+Tab のフォーカスをモーダル内で循環させる（hook 化済み）', () => {
    const { container, unmount } = render(
      <Modal isOpen onClose={() => {}} title="フォーカストラップ">
        <button type="button">本文のボタン</button>
      </Modal>,
    );

    const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!;
    const bodyButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '本文のボタン',
    )!;

    // 末尾で Tab → 先頭（閉じるボタン）へ
    focusElement(bodyButton);
    keyDown(document, 'Tab');
    expect(document.activeElement).toBe(closeButton);

    // 先頭で Shift+Tab → 末尾へ
    keyDown(document, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(bodyButton);
    unmount();
  });
});
