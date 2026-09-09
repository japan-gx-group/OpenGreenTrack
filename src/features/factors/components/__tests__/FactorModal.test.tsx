// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, focusElement, keyDown, render } from '@/lib/testing/render';
import { FactorModal } from '../FactorModal';

// 係数管理モーダル共通シェルの操作性のテスト。
// 共有の Modal.client.tsx と同じ振る舞い（Escape・dialog セマンティクス・フォーカス管理・スクロールロック）に加え、
// IME 変換中の Escape ではモーダルを閉じないことを検証する。

const getDialog = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="dialog"]')!;
const getCloseButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!;

describe('FactorModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('dialog セマンティクスを持ち、タイトル見出しと紐づく', () => {
    const { container, unmount } = render(
      <FactorModal title="係数の出典・算定式" onClose={() => {}}>
        <p>本文</p>
      </FactorModal>,
    );

    const dialog = getDialog(container);
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const heading = container.querySelector('h3')!;
    expect(heading.textContent).toBe('係数の出典・算定式');
    expect(heading.id).not.toBe('');
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    unmount();
  });

  it('Escape キーで onClose が呼ばれる', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <FactorModal title="確認" onClose={onClose}>
        <p>本文</p>
      </FactorModal>,
    );

    keyDown(document, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('IME 変換中の Escape（変換の取り消し）では閉じない', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <FactorModal title="確認" onClose={onClose}>
        <input type="text" />
      </FactorModal>,
    );

    keyDown(document, 'Escape', { isComposing: true });
    // 変換確定直後の keydown を isComposing=false・keyCode=229 で届けるブラウザ向けのガード
    keyDown(document, 'Escape', { keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();

    keyDown(document, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('閉じるボタンとオーバーレイのクリックで onClose が呼ばれ、パネル内クリックでは呼ばれない', () => {
    const onClose = vi.fn();
    const { container, unmount } = render(
      <FactorModal title="確認" onClose={onClose}>
        <p>本文</p>
      </FactorModal>,
    );

    click(getDialog(container));
    expect(onClose).not.toHaveBeenCalled();

    click(getCloseButton(container));
    expect(onClose).toHaveBeenCalledTimes(1);

    click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('開くと閉じるボタンへフォーカスし、閉じると開く前の要素へ戻す', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { container, unmount } = render(
      <FactorModal title="確認" onClose={() => {}}>
        <input type="text" />
      </FactorModal>,
    );
    expect(document.activeElement).toBe(getCloseButton(container));

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('Tab / Shift+Tab のフォーカスをモーダル内で循環させる', () => {
    const { container, unmount } = render(
      <FactorModal title="確認" onClose={() => {}}>
        <button type="button">本文のボタン</button>
      </FactorModal>,
    );

    const closeButton = getCloseButton(container);
    const bodyButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '本文のボタン',
    )!;

    focusElement(bodyButton);
    keyDown(document, 'Tab');
    expect(document.activeElement).toBe(closeButton);

    keyDown(document, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(bodyButton);
    unmount();
  });

  it('開いている間は body スクロールをロックし、閉じると元の値へ戻す', () => {
    document.body.style.overflow = 'auto';

    const { unmount } = render(
      <FactorModal title="確認" onClose={() => {}}>
        <p>本文</p>
      </FactorModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });
});
