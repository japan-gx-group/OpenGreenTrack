// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
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
