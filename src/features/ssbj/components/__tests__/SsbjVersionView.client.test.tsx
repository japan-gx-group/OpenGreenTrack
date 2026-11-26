// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { fictionalSnapshot, fictionalVersion } from '../../__fixtures__/fictionalReport';
import { fictionalDisclosedTexts, fictionalInternalTexts } from '../../__fixtures__/fictionalReportTexts';
import { toSsbjDisclosedSnapshot } from '../../utils/disclosedSnapshot';
import { SsbjVersionView } from '../SsbjVersionView.client';

let rendered: RenderResult | null = null;
afterEach(() => { rendered?.unmount(); rendered = null; });

const text = () => rendered?.container.textContent ?? '';
const selectTab = (label: string) => {
  const tab = Array.from(rendered!.container.querySelectorAll('[role="tab"]')).find(element => element.textContent === label);
  if (!tab) throw new Error(`タブ「${label}」がありません`);
  act(() => { tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
};
const toggleInternal = () => {
  const checkbox = rendered!.container.querySelector('button[role="checkbox"]');
  if (!checkbox) throw new Error('内部メモの切替がありません');
  click(checkbox);
};

describe('SsbjVersionView', () => {
  it('既定はレポートの形で、見出しは要求項目マスターの名前（英語のキー名・項目 ID の見出しを出さない）', () => {
    rendered = render(<SsbjVersionView version={fictionalVersion} approved={false} viewerOnly={false} />);
    expect(text()).toContain('版 1 の保存内容');
    expect(rendered.container.querySelector('[data-testid="ssbj-preview-source"]')?.textContent).toContain('保存版 第1版');
    expect(text()).toContain('監督する機関・責任者');
    expect(text()).toContain('該当性・重要性・記載しない理由');
    for (const key of ['narratives', 'judgements', 'external_emissions', 'itemId', 'applicability']) {
      expect(text()).not.toContain(key);
    }
    expect(fictionalDisclosedTexts.filter(value => !text().includes(value))).toEqual([]);
  });

  it('内部メモは既定で隠し、切替でレポートの形・表・JSON のどれにも出す', () => {
    rendered = render(<SsbjVersionView version={fictionalVersion} approved={false} viewerOnly={false} />);
    expect(fictionalInternalTexts.filter(value => text().includes(value))).toEqual([]);
    selectTab('表で見る');
    expect(fictionalInternalTexts.filter(value => text().includes(value))).toEqual([]);
    selectTab('JSON');
    expect(text()).not.toContain('internalNote');

    toggleInternal();
    expect(text()).toContain('internalNote');
    selectTab('表で見る');
    expect(text()).toContain('内部メモ（開示しない）');
    selectTab('レポートの形');
    expect(fictionalInternalTexts.filter(value => !text().includes(value))).toEqual([]);
  });

  it('「表で見る」は保存した項目の表、「JSON」は保存データそのもの', () => {
    rendered = render(<SsbjVersionView version={fictionalVersion} approved={false} viewerOnly={false} />);
    selectTab('表で見る');
    expect(text()).toContain('四本柱の文章');
    expect(text()).toContain('項目ID');
    expect(text()).toContain('governance.oversight_body');
    selectTab('JSON');
    const json = rendered.container.querySelector('[data-testid="ssbj-version-json"]')?.textContent ?? '';
    expect(JSON.parse(json)).toEqual(toSsbjDisclosedSnapshot(fictionalSnapshot).snapshot);
  });

  it('承認した版には印を出す', () => {
    rendered = render(<SsbjVersionView version={fictionalVersion} approved viewerOnly={false} />);
    expect(text()).toContain('承認した版');
  });

  it('閲覧者には内部メモの表示の切替を出さない', () => {
    const disclosed = { ...fictionalVersion, snapshot: toSsbjDisclosedSnapshot(fictionalSnapshot).snapshot };
    rendered = render(<SsbjVersionView version={disclosed} approved viewerOnly />);
    expect(rendered.container.querySelector('button[role="checkbox"]')).toBeNull();
    expect(text()).not.toContain('内部メモも表示する');
    expect(fictionalInternalTexts.filter(value => text().includes(value))).toEqual([]);
  });

  it('対応していない形式の保存版は、その旨だけを出す', () => {
    const broken = { ...fictionalVersion, reportId: '5b1f0000-0000-4000-8000-0000000000ff' };
    rendered = render(<SsbjVersionView version={broken} approved={false} viewerOnly={false} />);
    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toBe('対応していない保存版の形式です。');
    expect(rendered.container.querySelector('[role="tab"]')).toBeNull();
  });
});
