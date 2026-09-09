import { describe, expect, it } from 'vitest';
import { chunk, fetchAllRows, IN_CHUNK_SIZE, PAGE_SIZE, type PageResult } from '../supabaseRows';

describe('fetchAllRows', () => {
  // PAGE_SIZE 行ずつ返すダミーの runPage を作る
  const makeRunPage = (totalRows: number) => {
    const calls: Array<[number, number]> = [];
    const runPage = async (from: number, to: number): Promise<PageResult<number>> => {
      calls.push([from, to]);
      const rows: number[] = [];
      for (let i = from; i <= Math.min(to, totalRows - 1); i++) {
        rows.push(i);
      }
      return { data: rows, error: null };
    };
    return { runPage, calls };
  };

  it('1ページに収まる場合は1回の呼び出しで全行を返す', async () => {
    const { runPage, calls } = makeRunPage(3);
    const rows = await fetchAllRows(runPage, 'エラー');
    expect(rows).toEqual([0, 1, 2]);
    expect(calls).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it('PAGE_SIZE を超える行はページングして全行を返す', async () => {
    const total = PAGE_SIZE + 5;
    const { runPage, calls } = makeRunPage(total);
    const rows = await fetchAllRows(runPage, 'エラー');
    expect(rows).toHaveLength(total);
    expect(rows[0]).toBe(0);
    expect(rows[total - 1]).toBe(total - 1);
    expect(calls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ]);
  });

  it('ちょうど PAGE_SIZE の倍数の場合、最後に空ページを読んで終了する', async () => {
    const { runPage, calls } = makeRunPage(PAGE_SIZE);
    const rows = await fetchAllRows(runPage, 'エラー');
    expect(rows).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(2); // 2ページ目（空）で終了判定
  });

  it('エラー時は指定したメッセージで throw する', async () => {
    const runPage = async (): Promise<PageResult<number>> => ({ data: null, error: { message: 'db error' } });
    await expect(fetchAllRows(runPage, '取得に失敗しました')).rejects.toThrow('取得に失敗しました');
  });

  it('data が null（0行）の場合は空配列を返す', async () => {
    const runPage = async (): Promise<PageResult<number>> => ({ data: null, error: null });
    await expect(fetchAllRows(runPage, 'エラー')).resolves.toEqual([]);
  });
});

describe('chunk', () => {
  it('サイズごとに分割し、端数は最後のチャンクにまとめる', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('空配列は空のまま返す', () => {
    expect(chunk([], IN_CHUNK_SIZE)).toEqual([]);
  });

  it('サイズ以下の配列は1チャンクになる', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});
