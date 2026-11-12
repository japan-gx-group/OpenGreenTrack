// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, focusElement, keyDown, render, type RenderResult } from '@/lib/testing/render';
import { REGIONS } from '@/types/region';
import { LocationTable } from '../LocationTable.client';
import type { LocationRecord } from '../../types';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const ROW: LocationRecord = {
  id: 'loc-1',
  name: '本社拠点',
  region: REGIONS[0],
  type: 'headquarters',
  person: '山田',
  status: 'active',
};

describe('LocationTable 行クリック', () => {
  let rendered: RenderResult | null = null;

  beforeEach(() => {
    push.mockClear();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    rendered = render(
      <LocationTable
        rows={[ROW]}
        totalCount={1}
        isBusy={false}
        hasFetchedOnce
        loadFailed={false}
        onRetry={vi.fn()}
        menuTriggerRef={{ current: null }}
        onResetFilters={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
  });

  afterEach(() => {
    rendered?.unmount();
    rendered = null;
    vi.restoreAllMocks();
  });

  // 修飾キー付きのクリックを発火する（click ヘルパーは修飾キーを付けられないため直接 dispatch する）
  const modifiedClick = (element: Element, init: MouseEventInit) => {
    act(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    });
  };

  it('通常クリックは現在タブで拠点詳細へ遷移する', () => {
    const row = rendered!.container.querySelector('tbody tr')!;

    click(row);

    expect(push).toHaveBeenCalledWith('/locations/loc-1');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('Ctrl+クリックは現在タブを遷移させず新規タブで開く', () => {
    const row = rendered!.container.querySelector('tbody tr')!;

    modifiedClick(row, { ctrlKey: true });

    expect(push).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith('/locations/loc-1', '_blank', 'noopener');
  });
});

describe('LocationTable 行メニュー（⋮）のキーボード操作', () => {
  let rendered: RenderResult | null = null;
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const menuTriggerRef = { current: null as HTMLButtonElement | null };

  beforeAll(() => {
    // Radix のポップアップが位置計算に使う API。jsdom には無いため、何もしない実装を差し込む。
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    push.mockClear();
    onEdit.mockClear();
    onDelete.mockClear();
    menuTriggerRef.current = null;
    rendered = render(
      <LocationTable
        rows={[ROW]}
        totalCount={1}
        isBusy={false}
        hasFetchedOnce
        loadFailed={false}
        onRetry={vi.fn()}
        menuTriggerRef={menuTriggerRef}
        onResetFilters={vi.fn()}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
  });

  afterEach(() => {
    rendered?.unmount();
    rendered = null;
  });

  const getTrigger = () => rendered!.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  // メニューは Portal で document.body 直下に描かれる
  const getMenu = () => document.body.querySelector<HTMLElement>('[role="menu"]');
  const getItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  // 開閉・フォーカス移動は Radix が次のタスクで行うため、act の中で 1 タスク待つ
  const flush = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const openByKeyboard = async () => {
    focusElement(getTrigger());
    keyDown(getTrigger(), 'Enter');
    await flush();
    // 開いていなければ、以降の「閉じた」「描かれない」系の検証が空振りで通ってしまう
    expect(getMenu()).not.toBeNull();
  };

  it('キーボード（Enter）で開くと、先頭の項目へフォーカスが移る', async () => {
    await openByKeyboard();

    expect(getMenu()).not.toBeNull();
    expect(getTrigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(getItems()[0]);
  });

  it('↓ キーで次の項目へ、↑ キーで前の項目へフォーカスが移る', async () => {
    await openByKeyboard();

    keyDown(document.activeElement!, 'ArrowDown');
    await flush();
    expect(document.activeElement).toBe(getItems()[1]);

    keyDown(document.activeElement!, 'ArrowUp');
    await flush();
    expect(document.activeElement).toBe(getItems()[0]);
  });

  it('Escape でメニューが閉じ、フォーカスが ⋮ ボタンへ戻る', async () => {
    await openByKeyboard();

    keyDown(document.activeElement!, 'Escape');
    await flush();

    expect(getMenu()).toBeNull();
    expect(getTrigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(getTrigger());
  });

  it('キーボードで開いた場合も、閉じた後の復帰先として ⋮ ボタンを控える', async () => {
    await openByKeyboard();

    expect(menuTriggerRef.current).toBe(getTrigger());
  });

  it('透明な全面オーバーレイを描かない（次のクリックを吸い込まない）', async () => {
    await openByKeyboard();

    expect(document.body.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('「編集」を選ぶと onEdit が呼ばれ、行の遷移は起きず、⋮ へのフォーカス復帰もしない', async () => {
    await openByKeyboard();

    keyDown(getItems()[0], 'Enter');
    await flush();

    expect(onEdit).toHaveBeenCalledWith(ROW);
    expect(push).not.toHaveBeenCalled();
    expect(getMenu()).toBeNull();
    // モーダルがフォーカスを持つ前提なので、Radix 既定の ⋮ への復帰は止めている
    expect(document.activeElement).not.toBe(getTrigger());
  });

  it('「削除」を選ぶと onDelete が呼ばれる', async () => {
    await openByKeyboard();

    click(getItems()[1]);
    await flush();

    expect(onDelete).toHaveBeenCalledWith(ROW);
    expect(onEdit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
