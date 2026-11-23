// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { SsbjPreviewNarrativeItem } from '../SsbjPreviewNarrativeItem.client';

let rendered: RenderResult | null = null;
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  window.getSelection()?.removeAllRanges();
});

const ITEM_ID = 'governance.oversight_body';
const mount = (onSelect: (itemId: string) => void) => {
  rendered = render(
    <SsbjPreviewNarrativeItem itemId={ITEM_ID} label="監督する機関・責任者" isActive={false} isEditing={false} onSelect={onSelect}>
      <p data-testid="body">取締役会が監督している。</p>
    </SsbjPreviewNarrativeItem>,
  );
};
const selectBodyText = () => {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('[data-testid="body"]')!);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

describe('SsbjPreviewNarrativeItem', () => {
  it('項目のどこを押しても、項目名のボタンを押しても、その項目を選ぶ', () => {
    const onSelect = vi.fn();
    mount(onSelect);
    click(document.querySelector('[data-testid="body"]')!);
    click(document.querySelector('button')!);
    expect(onSelect.mock.calls).toEqual([[ITEM_ID], [ITEM_ID]]);
    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('「監督する機関・責任者」の入力へ移る');
  });

  it('文字を選択しているときは、本文を押しても左へ移らない（項目名のボタンなら移る）', () => {
    const onSelect = vi.fn();
    mount(onSelect);
    selectBodyText();
    click(document.querySelector('[data-testid="body"]')!);
    expect(onSelect).not.toHaveBeenCalled();
    click(document.querySelector('button')!);
    expect(onSelect).toHaveBeenCalledWith(ITEM_ID);
  });
});
