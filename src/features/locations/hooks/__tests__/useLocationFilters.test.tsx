// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import type { LocationRecord } from '../../types';
import { ALL_OPTION, useLocationFilters, type LocationFilters } from '../useLocationFilters';

// useLocationFilters の回帰テスト。
// 「地域・種別・稼働状況・検索で絞れる」「適用中の条件がピルとして並び、個別に解除できる」
// 「resetFilters で全部戻る」を固定する。

const location = (overrides: Partial<LocationRecord> & { id: string; name: string }): LocationRecord => ({
  region: 'Kanto',
  type: 'office',
  person: '',
  status: 'active',
  ...overrides,
} as LocationRecord);

const database: LocationRecord[] = [
  location({ id: 'l1', name: '東京本社', person: '山田' }),
  location({ id: 'l2', name: '大阪支社', region: 'Kansai', person: '佐藤' }),
  location({ id: 'l3', name: '横浜工場', type: 'factory', person: '山本', status: 'paused' }),
];

let latest: LocationFilters;
// レンダリング中にモジュール変数へ直接代入すると react-hooks/globals に弾かれるため、関数を経由して受け取る。
const capture = (value: LocationFilters) => { latest = value; };

const Probe = () => {
  capture(useLocationFilters(database));
  return null;
};

const names = (): string[] => latest.filteredData.map(item => item.name);

describe('useLocationFilters', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('既定では絞り込みなしで全件が並び、ピルは出ない', () => {
    const { unmount } = render(<Probe />);
    expect(latest.selectedRegion).toBe(ALL_OPTION);
    expect(names()).toEqual(['東京本社', '大阪支社', '横浜工場']);
    expect(latest.totalCount).toBe(3);
    expect(latest.activeFilters).toEqual([]);
    unmount();
  });

  it('地域・種別・稼働状況・検索（拠点名と担当者）で絞れる', () => {
    const { unmount } = render(<Probe />);

    act(() => latest.setSelectedRegion('Kansai'));
    expect(names()).toEqual(['大阪支社']);
    act(() => latest.setSelectedRegion(ALL_OPTION));

    act(() => latest.setSelectedType('factory'));
    expect(names()).toEqual(['横浜工場']);
    act(() => latest.setSelectedType(ALL_OPTION));

    act(() => latest.setSelectedStatus('paused'));
    expect(names()).toEqual(['横浜工場']);
    act(() => latest.setSelectedStatus(ALL_OPTION));

    act(() => latest.setSearchQuery('山'));
    expect(names()).toEqual(['東京本社', '横浜工場']);
    act(() => latest.setSearchQuery('大阪'));
    expect(names()).toEqual(['大阪支社']);
    unmount();
  });

  it('適用中の条件がピルとして並び、個別に解除できる', () => {
    const { unmount } = render(<Probe />);
    act(() => {
      latest.setSelectedRegion('Kanto');
      latest.setSelectedType('office');
      latest.setSearchQuery('東京');
    });
    expect(latest.activeFilters.map(filter => filter.label)).toEqual([
      '地域: 関東',
      '拠点種別: オフィス',
      '検索: 東京',
    ]);
    expect(names()).toEqual(['東京本社']);

    act(() => latest.activeFilters[0].onRemove());
    expect(latest.selectedRegion).toBe(ALL_OPTION);
    expect(latest.activeFilters.map(filter => filter.key)).toEqual(['type', 'search']);
    unmount();
  });

  it('resetFilters で全部の条件が初期値に戻る', () => {
    const { unmount } = render(<Probe />);
    act(() => {
      latest.setSelectedRegion('Kansai');
      latest.setSelectedStatus('paused');
      latest.setSearchQuery('x');
    });
    act(() => latest.resetFilters());
    expect(latest.activeFilters).toEqual([]);
    expect(latest.totalCount).toBe(3);
    unmount();
  });
});
