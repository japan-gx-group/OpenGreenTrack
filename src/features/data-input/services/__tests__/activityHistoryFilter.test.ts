import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HISTORY_FILTERS,
  HISTORY_FILTER_ALL,
  buildHistoryFilterOptions,
  filterActivityHistory,
  hasActiveHistoryFilters,
  type HistoryFilterItem,
} from '../activityHistoryFilter';

const items: HistoryFilterItem[] = [
  {
    id: 'record-1',
    name: '東京本社',
    locationValue: 'loc-tokyo',
    energy: '電気',
    categoryValue: 'electricity',
    amount: '1,200',
    unit: 'kWh',
    period: '2026/04/01 - 2026/06/30',
    periodMonth: '2026-04',
    periodEndMonth: '2026-06',
    status: '登録済み',
    date: '2026/07/01 10:00',
    createdAt: '2026-07-01T01:00:00.000Z',
    noteText: '四半期まとめ',
    emissionsText: '12.345',
  },
  {
    id: 'record-2',
    name: '大阪支社',
    locationValue: 'loc-osaka',
    energy: 'ガス',
    categoryValue: 'city_gas',
    amount: '300',
    unit: 'm3',
    period: '2026/07/01 - 2026/07/31',
    periodMonth: '2026-07',
    periodEndMonth: '2026-07',
    status: '登録済み',
    date: '2026/07/02 10:00',
    createdAt: '2026-07-02T01:00:00.000Z',
    noteText: '',
    emissionsText: '未算定',
  },
];

describe('filterActivityHistory', () => {
  it('キーワード・拠点・カテゴリで入力履歴を絞り込む', () => {
    expect(
      filterActivityHistory(items, {
        ...DEFAULT_HISTORY_FILTERS,
        searchQuery: '四半期',
        locationFilter: 'loc-tokyo',
        categoryFilter: 'electricity',
      }).map((item) => item.id),
    ).toEqual(['record-1']);
  });

  it('全角・半角の表記ゆれを吸収して検索できる', () => {
    expect(
      filterActivityHistory(items, {
        ...DEFAULT_HISTORY_FILTERS,
        searchQuery: '１２００',
      }).map((item) => item.id),
    ).toEqual(['record-1']);
  });

  it('対象年月レンジと履歴期間が重なる行を残す', () => {
    expect(
      filterActivityHistory(items, {
        ...DEFAULT_HISTORY_FILTERS,
        periodFrom: '2026-05',
        periodTo: '2026-05',
      }).map((item) => item.id),
    ).toEqual(['record-1']);
  });

  it('対象年月レンジの開始が終了より後なら一致なしにする', () => {
    expect(
      filterActivityHistory(items, {
        ...DEFAULT_HISTORY_FILTERS,
        periodFrom: '2026-08',
        periodTo: '2026-07',
      }),
    ).toEqual([]);
  });

  it('登録日時の新しい順・古い順で並べ替える', () => {
    expect(filterActivityHistory(items, DEFAULT_HISTORY_FILTERS).map((item) => item.id)).toEqual([
      'record-2',
      'record-1',
    ]);
    expect(
      filterActivityHistory(items, {
        ...DEFAULT_HISTORY_FILTERS,
        sortOrder: 'oldest',
      }).map((item) => item.id),
    ).toEqual(['record-1', 'record-2']);
  });

  it('排出量の表示値でも検索できる', () => {
    expect(
      filterActivityHistory(items, {
        ...DEFAULT_HISTORY_FILTERS,
        searchQuery: '12.345',
      }).map((item) => item.id),
    ).toEqual(['record-1']);
  });

  it('extraSearchText（Scope3積上げ行のカテゴリ名・IDEA製品名）でも検索できる', () => {
    const scope3Item: HistoryFilterItem = {
      ...items[0],
      id: 'record-scope3',
      energy: 'Scope3積上げ',
      categoryValue: 'scope3_activity',
      extraSearchText: 'カテゴリ1: 購入した製品・サービス ダミー製品',
    };
    expect(
      filterActivityHistory([...items, scope3Item], {
        ...DEFAULT_HISTORY_FILTERS,
        searchQuery: 'ダミー製品',
      }).map((item) => item.id),
    ).toEqual(['record-scope3']);
  });

  it('タイムゾーン表記が混在しても登録日時順を保つ', () => {
    // サーバ取得値（timestamptz の +00:00）と楽観更新（toISOString の Z）が混ざるケース。
    // localeCompare だと記号の重みで db のほうが新しいと判定されてしまう組み合わせ。
    const mixed = [
      { ...items[0], id: 'db', createdAt: '2026-07-01T01:00:00+00:00' },
      { ...items[1], id: 'local', createdAt: '2026-07-01T01:00:00.500Z' },
    ];
    expect(filterActivityHistory(mixed, DEFAULT_HISTORY_FILTERS).map((item) => item.id)).toEqual([
      'local',
      'db',
    ]);
  });

  it('有効な絞り込み条件の有無を判定する', () => {
    expect(hasActiveHistoryFilters(DEFAULT_HISTORY_FILTERS)).toBe(false);
    expect(
      hasActiveHistoryFilters({
        ...DEFAULT_HISTORY_FILTERS,
        locationFilter: 'loc-tokyo',
      }),
    ).toBe(true);
    expect(
      hasActiveHistoryFilters({
        ...DEFAULT_HISTORY_FILTERS,
        locationFilter: HISTORY_FILTER_ALL,
      }),
    ).toBe(false);
  });

  it('並び順の変更は絞り込み条件として扱わない', () => {
    expect(
      hasActiveHistoryFilters({ ...DEFAULT_HISTORY_FILTERS, sortOrder: 'oldest' }),
    ).toBe(false);
  });
});

describe('buildHistoryFilterOptions', () => {
  it('重複する値をまとめてラベル順に返す', () => {
    expect(
      buildHistoryFilterOptions(
        [items[1], items[0], items[0]],
        (item) => item.locationValue,
        (item) => item.name,
      ),
    ).toEqual([
      { value: 'loc-osaka', label: '大阪支社' },
      { value: 'loc-tokyo', label: '東京本社' },
    ]);
  });

  it('空の値を候補に出さず、空ラベルは後続の有効なラベルで補完する', () => {
    expect(
      buildHistoryFilterOptions(
        [
          { ...items[0], name: '' },
          items[0],
          { ...items[1], locationValue: '' },
        ],
        (item) => item.locationValue,
        (item) => item.name,
      ),
    ).toEqual([{ value: 'loc-tokyo', label: '東京本社' }]);
  });
});
