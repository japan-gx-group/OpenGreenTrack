// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { fictionalNarratives } from '../../__fixtures__/fictionalReport';
import { ssbjNarrativeEntriesOfSection } from '../../utils/narrative';
import { SsbjNarrativeItemCard } from '../SsbjNarrativeItemCard.client';

// 画面全体（SsbjNarratives）のテストで確かめにくい、カード単体の後片付けを確かめる。

let rendered: RenderResult | null = null;
afterEach(() => { rendered?.unmount(); rendered = null; });

const setTextareaValue = (textarea: HTMLTextAreaElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('SsbjNarrativeItemCard（未保存の知らせの後片付け）', () => {
  const entry = ssbjNarrativeEntriesOfSection('governance', fictionalNarratives)
    .find(candidate => candidate.itemId === 'governance.oversight_body')!;

  it('未保存のままカードが外れたら、未保存でなくなったと知らせる', () => {
    const onDirtyChange = vi.fn();
    rendered = render(<SsbjNarrativeItemCard entry={entry} onSave={vi.fn()} onDirtyChange={onDirtyChange} />);
    const editButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('編集'))!;
    click(editButton);
    setTextareaValue(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="開示する文章"]')!, '書きかけ');
    expect(onDirtyChange).toHaveBeenLastCalledWith('governance.oversight_body', true);
    rendered.unmount();
    rendered = null;
    expect(onDirtyChange).toHaveBeenLastCalledWith('governance.oversight_body', false);
  });

  it('未保存でないカードが外れても、何も知らせない', () => {
    const onDirtyChange = vi.fn();
    rendered = render(<SsbjNarrativeItemCard entry={entry} onSave={vi.fn()} onDirtyChange={onDirtyChange} />);
    rendered.unmount();
    rendered = null;
    expect(onDirtyChange).not.toHaveBeenCalled();
  });
});
