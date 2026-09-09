export const HISTORY_FILTER_ALL = 'all';

export type HistorySortOrder = 'newest' | 'oldest';

export interface HistoryFilterItem {
  id: string;
  name: string;
  locationValue: string;
  energy: string;
  categoryValue: string;
  amount: string;
  unit: string;
  period: string;
  periodMonth: string;
  periodEndMonth: string;
  status: string;
  date: string;
  createdAt: string;
  noteText: string;
  /** 一覧に表示している排出量の文字列（未算定は「未算定」）。キーワード検索の対象に含める。 */
  emissionsText: string;
  /**
   * 追加のキーワード検索対象（Scope3積上げ行のカテゴリ名・IDEA製品名など、
   * 上記の固定項目に載らない表示文字列）。省略可。
   */
  extraSearchText?: string;
}

export interface HistoryFilters {
  searchQuery: string;
  locationFilter: string;
  categoryFilter: string;
  periodFrom: string;
  periodTo: string;
  sortOrder: HistorySortOrder;
}

export interface HistoryFilterOption {
  value: string;
  label: string;
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  searchQuery: '',
  locationFilter: HISTORY_FILTER_ALL,
  categoryFilter: HISTORY_FILTER_ALL,
  periodFrom: '',
  periodTo: '',
  sortOrder: 'newest',
};

// createdAt は DB の timestamptz（`+00:00`）と楽観更新時の toISOString()（`Z`）が混ざるため、
// ロケール依存で記号の重みが変わる localeCompare ではなくコードポイント順で比較する。
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const normalizeSearchText = (value: string): string =>
  value.normalize('NFKC').toLowerCase();

const buildHistorySearchText = (item: HistoryFilterItem): string =>
  normalizeSearchText(
    [
      item.name,
      item.locationValue,
      item.energy,
      item.categoryValue,
      item.amount,
      item.amount.replace(/,/g, ''),
      item.unit,
      item.period,
      item.status,
      item.date,
      item.noteText,
      item.emissionsText,
      item.emissionsText.replace(/,/g, ''),
      item.extraSearchText ?? '',
    ].join(' '),
  );

// 検索文字列（NFKC正規化 + 全項目の連結）は履歴1件ごとに固定なので、item をキーに使い回す。
// 1キーストロークごとに全件を再正規化すると履歴が増えたときに入力が重くなるため。
// 履歴を取り直すと item は作り直されるので、古いエントリは GC に任せられる。
const searchTextCache = new WeakMap<HistoryFilterItem, string>();

const getHistorySearchText = (item: HistoryFilterItem): string => {
  const cached = searchTextCache.get(item);
  if (cached !== undefined) {
    return cached;
  }

  const searchText = buildHistorySearchText(item);
  searchTextCache.set(item, searchText);
  return searchText;
};

// 並び順は「絞り込み」ではないため判定に含めない。
export const hasActiveHistoryFilters = (filters: HistoryFilters): boolean =>
  filters.searchQuery.trim() !== '' ||
  filters.locationFilter !== HISTORY_FILTER_ALL ||
  filters.categoryFilter !== HISTORY_FILTER_ALL ||
  filters.periodFrom !== '' ||
  filters.periodTo !== '';

export const buildHistoryFilterOptions = (
  items: HistoryFilterItem[],
  getValue: (item: HistoryFilterItem) => string,
  getLabel: (item: HistoryFilterItem) => string,
): HistoryFilterOption[] => {
  const optionMap = new Map<string, string>();
  for (const item of items) {
    const value = getValue(item).trim();
    if (!value) {
      continue;
    }

    const label = getLabel(item).trim() || value;
    const currentLabel = optionMap.get(value);
    if (!currentLabel || currentLabel === value) {
      optionMap.set(value, label);
    }
  }
  return [...optionMap.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
};

export const filterActivityHistory = <T extends HistoryFilterItem>(
  items: T[],
  filters: HistoryFilters,
): T[] => {
  if (filters.periodFrom && filters.periodTo && filters.periodFrom > filters.periodTo) {
    return [];
  }

  const query = normalizeSearchText(filters.searchQuery.trim());
  const matched = items.filter((item) => {
    if (
      filters.locationFilter !== HISTORY_FILTER_ALL &&
      item.locationValue !== filters.locationFilter
    ) {
      return false;
    }
    if (
      filters.categoryFilter !== HISTORY_FILTER_ALL &&
      item.categoryValue !== filters.categoryFilter
    ) {
      return false;
    }
    if (filters.periodFrom && (!item.periodEndMonth || item.periodEndMonth < filters.periodFrom)) {
      return false;
    }
    if (filters.periodTo && (!item.periodMonth || item.periodMonth > filters.periodTo)) {
      return false;
    }
    if (query && !getHistorySearchText(item).includes(query)) {
      return false;
    }
    return true;
  });

  return matched.sort((a, b) => {
    const compared =
      filters.sortOrder === 'newest'
        ? compareText(b.createdAt, a.createdAt)
        : compareText(a.createdAt, b.createdAt);
    return compared !== 0 ? compared : compareText(a.id, b.id);
  });
};
