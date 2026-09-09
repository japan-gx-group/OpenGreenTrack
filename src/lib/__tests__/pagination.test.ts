import { describe, expect, it } from 'vitest';
import { buildPageItems } from '../pagination';

describe('buildPageItems', () => {
  it('7ページ以下なら全ページを省略なしで返す', () => {
    expect(buildPageItems(1, 1)).toEqual([1]);
    expect(buildPageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('0ページ（0件）なら空配列を返す', () => {
    expect(buildPageItems(1, 0)).toEqual([]);
  });

  it('先頭ページでは末尾側だけを省略する', () => {
    expect(buildPageItems(1, 20)).toEqual([1, 2, 'gap', 20]);
  });

  it('末尾ページでは先頭側だけを省略する', () => {
    expect(buildPageItems(20, 20)).toEqual([1, 'gap', 19, 20]);
  });

  it('中央のページでは前後を省略して現在ページ周辺を残す', () => {
    expect(buildPageItems(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
  });

  it('省略記号が1ページ分だけの隙間に入らない', () => {
    // current=3 のとき 2,3,4 が並ぶため 1 と 2 の間に 'gap' は入らない。
    expect(buildPageItems(3, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
  });

  it('ページ番号が重複せず昇順になる', () => {
    const items = buildPageItems(2, 10);
    const pages = items.filter((item): item is number => item !== 'gap');
    expect(pages).toEqual([...new Set(pages)].sort((a, b) => a - b));
  });
});
