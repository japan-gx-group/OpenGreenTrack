// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import { usePagination, type Pagination } from '../usePagination';

// usePagination の回帰テスト。
// 「件数が減って現在ページが末尾を越えたら最終ページへ丸める」「ページサイズ変更で 1 ページ目へ戻る」
// 「resetPage を呼ばない限り絞り込み後もページは動かない」を固定する。

let latest: Pagination<number>;
// レンダリング中にモジュール変数へ直接代入すると react-hooks/globals に弾かれるため、関数を経由して受け取る。
const capture = (value: Pagination<number>) => { latest = value; };

const Probe = ({ items, pageSize = 10, resetKey }: { items: number[]; pageSize?: number; resetKey?: unknown }) => {
  capture(usePagination(items, pageSize, { resetKey }));
  return null;
};

const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

describe('usePagination', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('現在ページ分だけを切り出し、総ページ数を計算する', () => {
    const { unmount } = render(<Probe items={range(25)} />);
    expect(latest.pageItems).toEqual(range(10));
    expect(latest.totalCount).toBe(25);
    expect(latest.totalPages).toBe(3);
    expect(latest.currentPage).toBe(1);

    act(() => latest.setPage(3));
    expect(latest.pageItems).toEqual([21, 22, 23, 24, 25]);
    expect(latest.currentPage).toBe(3);
    unmount();
  });

  it('0 件でも総ページ数は 1 で、現在ページは 1 のまま', () => {
    const { unmount } = render(<Probe items={[]} />);
    expect(latest.totalPages).toBe(1);
    expect(latest.currentPage).toBe(1);
    expect(latest.pageItems).toEqual([]);
    unmount();
  });

  it('件数が減って現在ページが末尾を越えたら最終ページへ丸める', () => {
    const items = range(25);
    const { rerender, unmount } = render(<Probe items={items} />);
    act(() => latest.setPage(3));

    rerender(<Probe items={range(12)} />);
    expect(latest.totalPages).toBe(2);
    expect(latest.currentPage).toBe(2);
    expect(latest.pageItems).toEqual([11, 12]);
    unmount();
  });

  it('ページサイズを変えると 1 ページ目へ戻る', () => {
    const { unmount } = render(<Probe items={range(25)} />);
    act(() => latest.setPage(2));
    act(() => latest.setPageSize(20));
    expect(latest.currentPage).toBe(1);
    expect(latest.pageSize).toBe(20);
    expect(latest.pageItems).toEqual(range(20));
    unmount();
  });

  it('resetPage を呼ばない限り、配列が入れ替わってもページは動かない', () => {
    const { rerender, unmount } = render(<Probe items={range(30)} />);
    act(() => latest.setPage(2));

    rerender(<Probe items={range(30).map(n => n * 10)} />);
    expect(latest.currentPage).toBe(2);
    expect(latest.pageItems[0]).toBe(110);

    act(() => latest.resetPage());
    expect(latest.currentPage).toBe(1);
    unmount();
  });

  it('resetKey が変わると 1 ページ目へ戻り、同じ値のままなら戻らない', () => {
    const { rerender, unmount } = render(<Probe items={range(30)} resetKey={1} />);
    act(() => latest.setPage(3));

    rerender(<Probe items={range(30)} resetKey={1} />);
    expect(latest.currentPage).toBe(3);

    rerender(<Probe items={range(30)} resetKey={2} />);
    expect(latest.currentPage).toBe(1);
    unmount();
  });
});
