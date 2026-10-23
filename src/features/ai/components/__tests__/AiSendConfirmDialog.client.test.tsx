// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { AiSendConfirmDialog } from '../AiSendConfirmDialog.client';

// 送る前に、送り先（提供元・モデル）と送る内容を見せ、「送信する」のときだけ送ることを確かめる。

const buttonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === text);

describe('AiSendConfirmDialog', () => {
  let view: RenderResult | null = null;

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  const mount = (props: Partial<React.ComponentProps<typeof AiSendConfirmDialog>> = {}) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    view = render(
      <AiSendConfirmDialog
        isOpen
        purposeLabel="請求書の読取り"
        provider="anthropic"
        modelId="claude-sonnet-5-5"
        items={[{ name: 'denki_2026-09.pdf', note: '312KB' }]}
        isSending={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
        {...props}
      />,
    );
    return { container: document.body, onConfirm, onCancel };
  };

  it('送り先と送る内容を見せ、「送信する」で onConfirm を呼ぶ', () => {
    const { container, onConfirm } = mount();
    expect(container.textContent).toContain('「請求書の読取り」のため');
    expect(container.textContent).toContain('Anthropic（Claude）');
    expect(container.textContent).toContain('claude-sonnet-5-5');
    expect(container.textContent).toContain('denki_2026-09.pdf');
    expect(container.textContent).toContain('312KB');
    click(buttonByText(container, '送信する') as HTMLButtonElement);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('「やめる」では送らない', () => {
    const { container, onConfirm, onCancel } = mount();
    click(buttonByText(container, 'やめる') as HTMLButtonElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('送り先が決まっていない・送る内容が無い・送信中は「送信する」を押せない', () => {
    for (const props of [{ provider: null }, { modelId: null }, { items: [] }, { isSending: true }]) {
      const { container } = mount(props);
      expect((buttonByText(container, '送信する') as HTMLButtonElement).disabled).toBe(true);
      view?.unmount();
      view = null;
    }
  });
});
