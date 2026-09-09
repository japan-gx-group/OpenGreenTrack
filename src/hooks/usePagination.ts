'use client';

// 一覧のクライアント側ページング。絞り込み済みの配列を渡すと、現在ページ分だけを切り出して返す。
//
// 絞り込みで件数が減って現在ページが末尾を越えたときは、状態を書き換えずに最終ページへ丸めて返す
// （currentPage は常に 1〜totalPages に収まる）。絞り込み条件を変えたときに 1 ページ目へ戻すかどうかは
// 呼び出し側が resetPage() で決める（条件によっては戻さない画面もあるため、ここでは自動で戻さない）。
//
// 例外は resetKey で、データの取り直し（初回取得・更新ボタン・CSV 取込後の再取得）のように
// 「イベントハンドラの外で起きる入れ替え」に合わせて 1 ページ目へ戻すために使う。
// キーが変わった描画の中で state を直す（React の「prop 変化に合わせて state を調整する」パターン）ので、
// 古いページ番号のまま一度描画されることはない。

import { useCallback, useMemo, useState } from 'react';

export interface Pagination<T> {
  /** 現在ページに表示する要素 */
  pageItems: T[];
  /** ページングする前の総件数 */
  totalCount: number;
  totalPages: number;
  /** 1〜totalPages に収めたページ番号 */
  currentPage: number;
  pageSize: number;
  setPage: (page: number) => void;
  /** 1 ページあたりの件数を変えると 1 ページ目へ戻す（表示位置が飛ばないように） */
  setPageSize: (pageSize: number) => void;
  resetPage: () => void;
}

export interface PaginationOptions {
  /** この値が変わったら 1 ページ目へ戻す（データの取り直しなど、操作と直接結びつかない入れ替え用） */
  resetKey?: unknown;
}

export function usePagination<T>(
  items: readonly T[],
  initialPageSize: number,
  { resetKey }: PaginationOptions = {},
): Pagination<T> {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSizeState] = useState<number>(initialPageSize);
  const [prevResetKey, setPrevResetKey] = useState<unknown>(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setCurrentPage(1);
  }

  const totalCount = items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const pageItems = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return items.slice(startIndex, startIndex + pageSize);
  }, [items, safeCurrentPage, pageSize]);

  const resetPage = useCallback(() => setCurrentPage(1), []);
  const setPageSize = useCallback((nextPageSize: number) => {
    setPageSizeState(nextPageSize);
    setCurrentPage(1);
  }, []);

  return {
    pageItems,
    totalCount,
    totalPages,
    currentPage: safeCurrentPage,
    pageSize,
    setPage: setCurrentPage,
    setPageSize,
    resetPage,
  };
}
