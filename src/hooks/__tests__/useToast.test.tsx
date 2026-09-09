// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { useToast } from '../useToast';

// useToast の回帰テスト。
// 「一定時間で消える」「続けて出したとき前のタイマーが新しいトーストを早期に消さない」を固定する。

let latest: ReturnType<typeof useToast>;
// レンダリング中にモジュール変数へ直接代入すると react-hooks/globals に弾かれるため、関数を経由して受け取る。
const capture = (value: ReturnType<typeof useToast>) => { latest = value; };

const Probe = () => {
  const result = useToast();
  capture(result);
  return <div data-testid="probe" data-message={result.toast?.message ?? ''} data-type={result.toast?.type ?? ''} />;
};

const probeOf = (container: HTMLElement): HTMLElement => container.querySelector('[data-testid="probe"]')!;

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('表示したトーストは 3 秒後に消える', () => {
    const { container, unmount } = render(<Probe />);

    act(() => latest.showToast('保存しました', 'success'));
    expect(probeOf(container).dataset.message).toBe('保存しました');
    expect(probeOf(container).dataset.type).toBe('success');

    act(() => { vi.advanceTimersByTime(2999); });
    expect(probeOf(container).dataset.message).toBe('保存しました');

    act(() => { vi.advanceTimersByTime(1); });
    expect(probeOf(container).dataset.message).toBe('');
    unmount();
  });

  it('続けて表示したとき、前のトーストの消去タイマーで新しいトーストが早く消えない', () => {
    const { container, unmount } = render(<Probe />);

    act(() => latest.showToast('1件目', 'success'));
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => latest.showToast('2件目', 'error'));

    // 1件目の消去タイミング（表示から 3 秒）を過ぎても 2件目は残る
    act(() => { vi.advanceTimersByTime(1500); });
    expect(probeOf(container).dataset.message).toBe('2件目');
    expect(probeOf(container).dataset.type).toBe('error');

    act(() => { vi.advanceTimersByTime(1500); });
    expect(probeOf(container).dataset.message).toBe('');
    unmount();
  });

  it('showToast の参照は再レンダリングをまたいでも変わらない', () => {
    const { unmount } = render(<Probe />);
    const first = latest.showToast;
    act(() => latest.showToast('x', 'success'));
    expect(latest.showToast).toBe(first);
    unmount();
  });
});
