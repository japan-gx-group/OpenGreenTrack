import { describe, it, expect } from 'vitest';
import { assignBlockLayout, type BlockSize } from '../treemapLayout';

const sizes = (emissions: number[]): BlockSize[] =>
  assignBlockLayout(emissions).map(layout => layout.size);

const ranks = (emissions: number[]): number[] =>
  assignBlockLayout(emissions).map(layout => layout.rank);

describe('assignBlockLayout', () => {
  it('排出量の降順で 大→中→中→小… を割り当てる（入力順は保持）', () => {
    // 入力は敢えて未ソート。最大の 500 が large になる。
    const emissions = [100, 500, 300, 50, 400, 10];
    expect(sizes(emissions)).toEqual([
      'small', //  100 → rank 3
      'large', //  500 → rank 0
      'medium', // 300 → rank 2
      'small', //   50 → rank 4
      'medium', // 400 → rank 1
      'small', //   10 → rank 5
    ]);
    expect(ranks(emissions)).toEqual([3, 0, 2, 4, 1, 5]);
  });

  it('カテゴリ数が可変でも破綻しない', () => {
    expect(sizes([])).toEqual([]);
    expect(sizes([42])).toEqual(['large']); // 1カテゴリのみ
    expect(sizes([9, 8])).toEqual(['large', 'medium']);
    expect(sizes([5, 4, 3])).toEqual(['large', 'medium', 'medium']);
    // 中は最大2つまで。4つ目以降は小。
    expect(sizes([5, 4, 3, 2, 1])).toEqual(['large', 'medium', 'medium', 'small', 'small']);

    const many = Array.from({ length: 15 }, (_, i) => 15 - i);
    const result = sizes(many);
    expect(result[0]).toBe('large');
    expect(result.filter(s => s === 'large')).toHaveLength(1);
    expect(result.filter(s => s === 'medium')).toHaveLength(2);
    expect(result.filter(s => s === 'small')).toHaveLength(12);
  });

  it('同値は安定的（入力順で先のものを上位ランク）に割り当てる', () => {
    const emissions = [100, 100, 100, 100];
    expect(ranks(emissions)).toEqual([0, 1, 2, 3]);
    expect(sizes(emissions)).toEqual(['large', 'medium', 'medium', 'small']);
  });

  it('排出量0以下は面積で強調せず小にする', () => {
    // 0 は rank 上どこに来ても small。
    expect(sizes([10, 0, 5, 0])).toEqual(['large', 'small', 'medium', 'small']);
    // 全て0なら large は生まれない。
    expect(sizes([0, 0, 0])).toEqual(['small', 'small', 'small']);
    // 負値も 0 以下として扱う。
    expect(sizes([-1, 20])).toEqual(['small', 'large']);
  });
});
