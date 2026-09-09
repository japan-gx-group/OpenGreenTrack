// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import type { SavedManualActivityRecord } from '../../types';
import { toHistoryItem } from '../useActivityHistory';
import { useHistoryFilters, type HistoryFilters } from '../useHistoryFilters';

// useHistoryFilters の回帰テスト。
// 「拠点・カテゴリの候補は履歴から作る」「各条件で絞れる」「clearFilters は並び順を維持する」を固定する。

const record = (overrides: Partial<SavedManualActivityRecord> & { id: string }): SavedManualActivityRecord => ({
  locationId: 'loc-1',
  locationName: '東京本社',
  energyType: 'electricity',
  amount: 100,
  unit: 'kWh',
  periodStart: '2025-04-01',
  periodEnd: '2025-04-30',
  note: null,
  createdAt: '2025-05-01T09:00:00+09:00',
  emissionFactorId: null,
  emissions: 1,
  scope3CategoryId: null,
  ideaFactorId: null,
  ideaProductName: null,
  ...overrides,
});

const history = [
  record({ id: 'r1', createdAt: '2025-05-01T09:00:00+09:00' }),
  record({ id: 'r2', locationId: 'loc-2', locationName: '大阪支社', energyType: 'city_gas', unit: 'm³', createdAt: '2025-05-02T09:00:00+09:00' }),
  record({ id: 'r3', periodStart: '2025-06-01', periodEnd: '2025-06-30', note: '検針値', createdAt: '2025-05-03T09:00:00+09:00' }),
].map((item) => toHistoryItem(item));

let latest: HistoryFilters;
// レンダリング中にモジュール変数へ直接代入すると react-hooks/globals に弾かれるため、関数を経由して受け取る。
const capture = (value: HistoryFilters) => { latest = value; };

const Probe = () => {
  capture(useHistoryFilters(history));
  return null;
};

const ids = (): string[] => latest.filteredHistory.map((item) => item.id);

describe('useHistoryFilters', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('既定では新しい順に全件が並び、拠点・カテゴリの候補は履歴から作る', () => {
    const { unmount } = render(<Probe />);
    expect(ids()).toEqual(['r3', 'r2', 'r1']);
    expect(latest.hasActiveFilters).toBe(false);
    // 候補の並び順は buildHistoryFilterOptions が決めるので、ここでは中身だけを見る。
    expect(latest.locationOptions.map((option) => option.label).sort()).toEqual(['大阪支社', '東京本社'].sort());
    expect(latest.categoryOptions.map((option) => option.label).sort()).toEqual(['ガス', '電気'].sort());
    unmount();
  });

  it('キーワード・拠点・カテゴリ・対象年月で絞れる', () => {
    const { unmount } = render(<Probe />);

    act(() => latest.setSearchQuery('検針'));
    expect(ids()).toEqual(['r3']);
    act(() => latest.setSearchQuery(''));

    act(() => latest.setLocationFilter('loc-2'));
    expect(ids()).toEqual(['r2']);
    act(() => latest.setLocationFilter('all'));

    act(() => latest.setCategoryFilter('electricity'));
    expect(ids()).toEqual(['r3', 'r1']);
    act(() => latest.setCategoryFilter('all'));

    act(() => latest.setPeriodFrom('2025-06'));
    expect(ids()).toEqual(['r3']);
    expect(latest.hasActiveFilters).toBe(true);
    unmount();
  });

  it('clearFilters は絞り込みを戻し、並び順は維持する', () => {
    const { unmount } = render(<Probe />);
    act(() => {
      latest.setSortOrder('oldest');
      latest.setSearchQuery('大阪');
      latest.setPeriodTo('2025-05');
    });
    expect(ids()).toEqual(['r2']);

    act(() => latest.clearFilters());
    expect(latest.hasActiveFilters).toBe(false);
    expect(latest.sortOrder).toBe('oldest');
    expect(ids()).toEqual(['r1', 'r2', 'r3']);
    unmount();
  });
});
