// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { isLeavingLinkClick, useUnsavedChangesGuard } from '../useUnsavedChangesGuard';

// 保存していない入力があるまま画面を離れる操作を止めるフックのテスト。
// jsdom はリンクでの移動ができないため、document の bubble 段階で、リンクの click が届いたか（止められなかったか）を数える。

const current = new URL('http://localhost:3000/ssbj/report-1/narratives?tab=a');
const anchor = (href: string, attrs: Record<string, string> = {}): HTMLAnchorElement => {
  const element = document.createElement('a');
  element.setAttribute('href', href);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  return element;
};
const plainClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

describe('isLeavingLinkClick', () => {
  it('同じオリジンの別の画面への移動だけを止める', () => {
    expect(isLeavingLinkClick(plainClick, anchor('/ssbj/report-1'), current)).toBe(true);
    expect(isLeavingLinkClick(plainClick, anchor('/ssbj/report-1/narratives?tab=b'), current)).toBe(true);
    expect(isLeavingLinkClick(plainClick, anchor('http://localhost:3000/dashboard'), current)).toBe(true);
  });

  it('同じ画面の中の移動（# だけが違う・同じ URL）は止めない', () => {
    expect(isLeavingLinkClick(plainClick, anchor('#ssbj-narratives-strategy'), current)).toBe(false);
    expect(isLeavingLinkClick(plainClick, anchor('/ssbj/report-1/narratives?tab=a#x'), current)).toBe(false);
    expect(isLeavingLinkClick(plainClick, anchor('/ssbj/report-1/narratives?tab=a'), current)).toBe(false);
  });

  it('新しいタブ・別のオリジン・ダウンロード・修飾キーや中クリックは止めない', () => {
    expect(isLeavingLinkClick(plainClick, anchor('/ssbj/report-1', { target: '_blank' }), current)).toBe(false);
    expect(isLeavingLinkClick(plainClick, anchor('/ssbj/report-1', { target: '_self' }), current)).toBe(true);
    expect(isLeavingLinkClick(plainClick, anchor('https://example.com/'), current)).toBe(false);
    expect(isLeavingLinkClick(plainClick, anchor('/files/a.csv', { download: '' }), current)).toBe(false);
    expect(isLeavingLinkClick(plainClick, anchor('/api/ssbj/report-1/export.xlsx'), current)).toBe(false);
    expect(isLeavingLinkClick(plainClick, anchor('http://localhost:3000/api/x'), current)).toBe(false);
    expect(isLeavingLinkClick(plainClick, anchor('/apis'), current)).toBe(true);
    expect(isLeavingLinkClick({ ...plainClick, metaKey: true }, anchor('/ssbj/report-1'), current)).toBe(false);
    expect(isLeavingLinkClick({ ...plainClick, ctrlKey: true }, anchor('/ssbj/report-1'), current)).toBe(false);
    expect(isLeavingLinkClick({ ...plainClick, button: 1 }, anchor('/ssbj/report-1'), current)).toBe(false);
    expect(isLeavingLinkClick({ ...plainClick, defaultPrevented: true }, anchor('/ssbj/report-1'), current)).toBe(false);
  });
});

let latest: ReturnType<typeof useUnsavedChangesGuard>;
const capture = (value: ReturnType<typeof useUnsavedChangesGuard>) => { latest = value; };

// next/link の代わりに素の a を使う（フックはリンクの種類によらず a[href] を見る。jsdom では next/link のルーターが無いため）。
const LEAVE_HREF = '/ssbj/report-1';
const Probe = ({ enabled }: { enabled: boolean }) => {
  const guard = useUnsavedChangesGuard(enabled);
  capture(guard);
  return (
    <div>
      <a href={LEAVE_HREF} data-testid="leave"><span data-testid="leave-inner">レポート詳細へ戻る</span></a>
      <a href="#section" data-testid="hash">章へ</a>
      <p data-testid="state">{guard.isConfirming ? 'confirming' : 'idle'}</p>
    </div>
  );
};

let rendered: RenderResult | null = null;
let reached: string[] = [];
// リンクの click が document まで届いたら記録し、jsdom の「移動は未実装」のエラーを出さないよう既定の動作を止める。
const recordReached = (event: Event) => {
  const link = (event.target as Element).closest('a');
  if (link) reached.push(link.getAttribute('href') ?? '');
  event.preventDefault();
};
const stateOf = () => document.querySelector('[data-testid="state"]')?.textContent;
const dispatchBeforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('useUnsavedChangesGuard', () => {
  afterEach(() => {
    rendered?.unmount();
    rendered = null;
    reached = [];
    document.removeEventListener('click', recordReached);
  });

  const mount = (enabled: boolean) => {
    document.addEventListener('click', recordReached);
    rendered = render(<Probe enabled={enabled} />);
  };

  it('未保存が無ければ、何も止めない', () => {
    mount(false);
    click(document.querySelector('[data-testid="leave"]')!);
    expect(reached).toEqual(['/ssbj/report-1']);
    expect(stateOf()).toBe('idle');
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it('未保存がある間は、タブを閉じる・再読み込みをブラウザの確認で止める', () => {
    mount(true);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
    rendered!.rerender(<Probe enabled={false} />);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it('未保存がある間は、別の画面へのリンクを止めて確認を待つ。リンクの中の要素を押しても同じ', () => {
    mount(true);
    click(document.querySelector('[data-testid="leave-inner"]')!);
    expect(reached).toEqual([]);
    expect(stateOf()).toBe('confirming');
  });

  it('同じ画面の中のリンク（#）は止めない', () => {
    mount(true);
    click(document.querySelector('[data-testid="hash"]')!);
    expect(reached).toEqual(['#section']);
    expect(stateOf()).toBe('idle');
  });

  it('「編集に戻る」では移動せず、もう一度押せばまた止める', () => {
    mount(true);
    click(document.querySelector('[data-testid="leave"]')!);
    act(() => latest.cancelLeave());
    expect(stateOf()).toBe('idle');
    expect(reached).toEqual([]);
    click(document.querySelector('[data-testid="leave"]')!);
    expect(stateOf()).toBe('confirming');
  });

  it('「破棄して移動」では、止めたリンクを押し直して移動させ、その後の beforeunload も止めない', () => {
    mount(true);
    click(document.querySelector('[data-testid="leave"]')!);
    act(() => latest.confirmLeave());
    expect(reached).toEqual(['/ssbj/report-1']);
    expect(stateOf()).toBe('idle');
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it('「破棄して移動」で通すのは押し直しの 1 回だけで、同じ画面に残ったら次のリンクはまた止める', () => {
    mount(true);
    click(document.querySelector('[data-testid="leave"]')!);
    act(() => latest.confirmLeave());
    expect(reached).toEqual(['/ssbj/report-1']);
    click(document.querySelector('[data-testid="leave"]')!);
    expect(reached).toEqual(['/ssbj/report-1']);
    expect(stateOf()).toBe('confirming');
  });

  it('「破棄して移動」の後も、利用者が次に操作したら、タブを閉じる・再読み込みをまた止める', () => {
    mount(true);
    click(document.querySelector('[data-testid="leave"]')!);
    act(() => latest.confirmLeave());
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  });

  it('確認を待つ間に未保存が無くなったら、確認を閉じる（後で未保存になっても古い移動の確認を出さない）', () => {
    mount(true);
    click(document.querySelector('[data-testid="leave"]')!);
    rendered!.rerender(<Probe enabled={false} />);
    expect(stateOf()).toBe('idle');
    rendered!.rerender(<Probe enabled={true} />);
    expect(stateOf()).toBe('idle');
    expect(reached).toEqual([]);
  });
});
