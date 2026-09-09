'use client';

// 入力履歴の絞り込み欄（キーワード / 拠点 / カテゴリ / 対象年月 / 並び順）。
// 状態と候補は useHistoryFilters が持ち、ここは入力欄だけを描画する。
// 条件を変えたら onChange を呼ぶ（画面本体がページを 1 に戻す）。

import { Search, X } from 'lucide-react';
import type { HistoryFilters } from '../hooks/useHistoryFilters';
import { HISTORY_FILTER_ALL, type HistorySortOrder } from '../services/activityHistoryFilter';

const HISTORY_SORT_OPTIONS: { value: HistorySortOrder; label: string }[] = [
  { value: 'newest', label: '登録日時が新しい順' },
  { value: 'oldest', label: '登録日時が古い順' },
];

interface ActivityHistoryFilterBarProps {
  filters: HistoryFilters;
  /** 絞り込み条件・並び順が変わったときに呼ぶ */
  onChange: () => void;
  /** 「絞り込みをクリア」（画面本体でページ戻しと組み合わせたもの） */
  onClear: () => void;
}

export const ActivityHistoryFilterBar = ({ filters, onChange, onClear }: ActivityHistoryFilterBarProps) => {
  // 絞り込み・並び順を変えると同じページ番号でも中身が変わるため、いずれも onChange で 1 ページ目に戻してもらう。
  const changeSearchQuery = (value: string) => { filters.setSearchQuery(value); onChange(); };
  const changeLocationFilter = (value: string) => { filters.setLocationFilter(value); onChange(); };
  const changeCategoryFilter = (value: string) => { filters.setCategoryFilter(value); onChange(); };
  const changePeriodFrom = (value: string) => { filters.setPeriodFrom(value); onChange(); };
  const changePeriodTo = (value: string) => { filters.setPeriodTo(value); onChange(); };
  const changeSortOrder = (value: HistorySortOrder) => { filters.setSortOrder(value); onChange(); };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-[220px] flex-[2] flex-col gap-1">
        <label htmlFor="history-search" className="text-xs font-semibold text-text-muted">
          キーワード検索
        </label>
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            id="history-search"
            type="text"
            className="gt-field"
            // .gt-field の一括 padding が Tailwind の pl-10 を上書きしてアイコンと文字が
            // 重なるため、左パディングはインラインで確実に確保する。
            // 右はクリアボタンと文字が重ならないよう、入力があるときだけ空ける。
            style={{
              paddingLeft: '2.25rem',
              paddingRight: filters.searchQuery ? '2.5rem' : undefined,
            }}
            placeholder="拠点名・カテゴリ・備考などで検索..."
            value={filters.searchQuery}
            onChange={(event) => changeSearchQuery(event.target.value)}
          />
          {filters.searchQuery && (
            <button
              type="button"
              onClick={() => changeSearchQuery('')}
              aria-label="入力履歴の検索をクリア"
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded border-none bg-transparent p-1 text-text-muted hover:bg-bg-subtle hover:text-text-main focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-w-[180px] flex-1 flex-col gap-1">
        <label htmlFor="history-location-filter" className="text-xs font-semibold text-text-muted">
          拠点
        </label>
        <select
          id="history-location-filter"
          className="gt-field gt-field-select"
          value={filters.locationFilter}
          onChange={(event) => changeLocationFilter(event.target.value)}
        >
          <option value={HISTORY_FILTER_ALL}>すべての拠点</option>
          {filters.locationOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-[180px] flex-1 flex-col gap-1">
        <label htmlFor="history-category-filter" className="text-xs font-semibold text-text-muted">
          カテゴリ
        </label>
        <select
          id="history-category-filter"
          className="gt-field gt-field-select"
          value={filters.categoryFilter}
          onChange={(event) => changeCategoryFilter(event.target.value)}
        >
          <option value={HISTORY_FILTER_ALL}>すべてのカテゴリ</option>
          {filters.categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-[240px] flex-[1.4] flex-col gap-1">
        <label htmlFor="history-period-from" className="text-xs font-semibold text-text-muted">
          対象年月
        </label>
        <div className="flex items-center gap-2">
          <input
            id="history-period-from"
            type="month"
            className="gt-field min-w-0 flex-1"
            aria-label="対象年月の開始"
            value={filters.periodFrom}
            max={filters.periodTo || undefined}
            onChange={(event) => changePeriodFrom(event.target.value)}
          />
          <span className="shrink-0 text-text-muted">〜</span>
          <input
            id="history-period-to"
            type="month"
            className="gt-field min-w-0 flex-1"
            aria-label="対象年月の終了"
            value={filters.periodTo}
            min={filters.periodFrom || undefined}
            onChange={(event) => changePeriodTo(event.target.value)}
          />
        </div>
      </div>

      <div className="flex min-w-[180px] flex-1 flex-col gap-1">
        <label htmlFor="history-sort" className="text-xs font-semibold text-text-muted">
          並び順
        </label>
        <select
          id="history-sort"
          className="gt-field gt-field-select"
          value={filters.sortOrder}
          onChange={(event) => changeSortOrder(event.target.value as HistorySortOrder)}
        >
          {HISTORY_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {filters.hasActiveFilters && (
        <div className="flex min-w-[140px] items-end">
          <button type="button" className="gt-btn" onClick={onClear}>
            絞り込みをクリア
          </button>
        </div>
      )}
    </div>
  );
};
