'use client';

// 一覧画面のページネーション（件数表示 / ページ送り / 表示件数セレクト）。
// 入力履歴・拠点一覧・排出係数マスタで見た目と操作を揃えるため、各画面のコピーをここに集約する。
// ページ番号ボタンの並び（省略記号の入れ方）は src/lib/pagination.ts の buildPageItems に従う。

import React, { useState } from 'react';
import { buildPageItems, hasHiddenPages } from '@/lib/pagination';

export interface PaginationProps {
  /** 絞り込み後の総件数 */
  totalCount: number;
  /** 1〜totalPages に丸め済みの現在ページ */
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  /** nav / select の aria-label に使う一覧の名前（例: '入力履歴'） */
  label: string;
  /** 左端の件数表示の上書き。絞り込み中は「全体の件数」も出したい画面（入力履歴）で使う */
  summary?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export const Pagination = ({
  totalCount,
  currentPage,
  totalPages,
  pageSize,
  pageSizeOptions,
  label,
  summary,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) => {
  const [pageInput, setPageInput] = useState<string>('');

  const startIndex = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalCount);

  const jumpToPage = () => {
    const target = Number(pageInput);
    if (Number.isInteger(target) && target >= 1 && target <= totalPages) {
      onPageChange(target);
    }
    setPageInput('');
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
      <div>{summary ?? `全 ${totalCount}件中 ${startIndex}-${endIndex} 件を表示`}</div>

      {/* 1ページに収まる間は操作不能なボタンだけが並ぶため、ページ送りUI自体を出さない。
          件数表示と表示件数セレクトは常に残す。 */}
      {totalPages > 1 && (
        <nav className="flex flex-wrap gap-1" aria-label={`${label}のページネーション`}>
          <button
            type="button"
            className="gt-btn disabled:cursor-not-allowed disabled:opacity-50"
            style={{ padding: '0.25rem 0.5rem' }}
            disabled={currentPage === 1}
            aria-label="前のページへ"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          >
            &lt;
          </button>
          {buildPageItems(currentPage, totalPages).map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} className="select-none px-2" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className={`gt-btn ${currentPage === item ? 'border-primary font-bold text-primary' : ''}`}
                style={{ padding: '0.25rem 0.75rem' }}
                aria-current={currentPage === item ? 'page' : undefined}
                aria-label={currentPage === item ? `${item}ページ目（現在のページ）` : `${item}ページ目へ`}
                onClick={() => onPageChange(item)}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            className="gt-btn disabled:cursor-not-allowed disabled:opacity-50"
            style={{ padding: '0.25rem 0.5rem' }}
            disabled={currentPage === totalPages}
            aria-label="次のページへ"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          >
            &gt;
          </button>
        </nav>
      )}

      <div className="flex items-center gap-2">
        {/* ページ番号直接入力: 省略記号でボタンが出ない中間ページへ一発で移動する。
            省略が発生するページ数のときだけ表示する。 */}
        {hasHiddenPages(totalPages) && (
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              jumpToPage();
            }}
          >
            <input
              type="number"
              min={1}
              max={totalPages}
              className="gt-field"
              style={{ width: '4rem', padding: '0.25rem 0.5rem', margin: 0 }}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              placeholder={String(currentPage)}
              aria-label="移動先ページ番号"
            />
            <span className="whitespace-nowrap">/ {totalPages}</span>
            <button type="submit" className="gt-btn h-auto px-2 py-1">
              移動
            </button>
          </form>
        )}
        <select
          className="gt-field"
          style={{ width: 'auto', padding: '0.25rem 2rem 0.25rem 0.5rem', margin: 0 }}
          value={pageSize}
          aria-label={`${label}の表示件数`}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}件表示
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
