'use client';

// 入力履歴の絞り込み（キーワード / 拠点 / カテゴリ / 対象年月）と並び順。
// 判定は services/activityHistoryFilter.ts の純関数に委ね、ここでは状態と候補リストだけを持つ。
// ページングはここでは扱わない（条件を変えたときに 1 ページ目へ戻すのは呼び出し側の責務）。

import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_HISTORY_FILTERS,
  HISTORY_FILTER_ALL,
  buildHistoryFilterOptions,
  filterActivityHistory,
  hasActiveHistoryFilters,
  type HistoryFilters as HistoryFilterValues,
  type HistorySortOrder,
} from '../services/activityHistoryFilter';
import type { HistoryItem } from './useActivityHistory';

export interface HistoryFilterOption {
  value: string;
  label: string;
}

export interface HistoryFilters {
  searchQuery: string;
  locationFilter: string;
  categoryFilter: string;
  periodFrom: string;
  periodTo: string;
  sortOrder: HistorySortOrder;
  setSearchQuery: (value: string) => void;
  setLocationFilter: (value: string) => void;
  setCategoryFilter: (value: string) => void;
  setPeriodFrom: (value: string) => void;
  setPeriodTo: (value: string) => void;
  setSortOrder: (value: HistorySortOrder) => void;
  locationOptions: HistoryFilterOption[];
  categoryOptions: HistoryFilterOption[];
  /** 絞り込み・並び替え後の一覧（ページング前） */
  filteredHistory: HistoryItem[];
  /** 絞り込み条件が 1 つでも入っている（並び順は含めない） */
  hasActiveFilters: boolean;
  /** 絞り込みを初期値に戻す。並び順は絞り込み条件ではないため維持する */
  clearFilters: () => void;
}

export function useHistoryFilters(history: HistoryItem[]): HistoryFilters {
  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState<string>(HISTORY_FILTER_ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(HISTORY_FILTER_ALL);
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [sortOrder, setSortOrder] = useState<HistorySortOrder>('newest');

  const values = useMemo<HistoryFilterValues>(
    () => ({ searchQuery, locationFilter, categoryFilter, periodFrom, periodTo, sortOrder }),
    [categoryFilter, locationFilter, periodFrom, periodTo, searchQuery, sortOrder],
  );

  const locationOptions = useMemo(
    () => buildHistoryFilterOptions(history, (item) => item.locationValue, (item) => item.name),
    [history],
  );

  const categoryOptions = useMemo(
    () => buildHistoryFilterOptions(history, (item) => item.categoryValue, (item) => item.energy),
    [history],
  );

  const filteredHistory = useMemo(
    () => filterActivityHistory(history, values),
    [history, values],
  );

  const clearFilters = useCallback(() => {
    setSearchQuery(DEFAULT_HISTORY_FILTERS.searchQuery);
    setLocationFilter(DEFAULT_HISTORY_FILTERS.locationFilter);
    setCategoryFilter(DEFAULT_HISTORY_FILTERS.categoryFilter);
    setPeriodFrom(DEFAULT_HISTORY_FILTERS.periodFrom);
    setPeriodTo(DEFAULT_HISTORY_FILTERS.periodTo);
  }, []);

  return {
    searchQuery,
    locationFilter,
    categoryFilter,
    periodFrom,
    periodTo,
    sortOrder,
    setSearchQuery,
    setLocationFilter,
    setCategoryFilter,
    setPeriodFrom,
    setPeriodTo,
    setSortOrder,
    locationOptions,
    categoryOptions,
    filteredHistory,
    hasActiveFilters: hasActiveHistoryFilters(values),
    clearFilters,
  };
}
