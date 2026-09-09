'use client';

// 拠点一覧の絞り込み（地域 / 拠点種別 / 稼働状況 / 検索）と、適用中の条件のピル表示用リスト。
// ページングはここでは扱わない（絞り込みを変えたときに 1 ページ目へ戻すのは呼び出し側の責務）。

import { useMemo, useState } from 'react';
import {
  getLocationStatusLabel,
  getLocationTypeLabel,
  getRegionLabel,
  type LocationRecord,
  type LocationStatus,
  type LocationType,
  type Region,
} from '../types';

export const ALL_OPTION = 'all';
export type AllOption = typeof ALL_OPTION;

export interface ActiveLocationFilter {
  key: string;
  label: string;
  /** この条件だけを解除する */
  onRemove: () => void;
}

export interface LocationFilters {
  selectedRegion: Region | AllOption;
  selectedType: LocationType | AllOption;
  selectedStatus: LocationStatus | AllOption;
  searchQuery: string;
  setSelectedRegion: (value: Region | AllOption) => void;
  setSelectedType: (value: LocationType | AllOption) => void;
  setSelectedStatus: (value: LocationStatus | AllOption) => void;
  setSearchQuery: (value: string) => void;
  /** 絞り込み後の一覧（ページング前） */
  filteredData: LocationRecord[];
  totalCount: number;
  /** 適用中の絞り込み条件。ピル表示と個別解除に使う。 */
  activeFilters: ActiveLocationFilter[];
  /** すべての絞り込みを初期状態に戻す */
  resetFilters: () => void;
}

export function useLocationFilters(database: LocationRecord[]): LocationFilters {
  const [selectedRegion, setSelectedRegion] = useState<Region | AllOption>(ALL_OPTION);
  const [selectedType, setSelectedType] = useState<LocationType | AllOption>(ALL_OPTION);
  const [selectedStatus, setSelectedStatus] = useState<LocationStatus | AllOption>(ALL_OPTION);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredData = useMemo(() => {
    let result = [...database];

    if (selectedRegion !== ALL_OPTION) {
      result = result.filter(item => item.region === selectedRegion);
    }
    if (selectedType !== ALL_OPTION) {
      result = result.filter(item => item.type === selectedType);
    }
    if (selectedStatus !== ALL_OPTION) {
      result = result.filter(item => item.status === selectedStatus);
    }
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(item =>
        item.name.toLowerCase().includes(q) ||
        item.person.toLowerCase().includes(q)
      );
    }
    return result;
  }, [database, selectedRegion, selectedType, selectedStatus, searchQuery]);

  const activeFilters: ActiveLocationFilter[] = [];
  if (selectedRegion !== ALL_OPTION) {
    activeFilters.push({
      key: 'region',
      label: `地域: ${getRegionLabel(selectedRegion)}`,
      onRemove: () => setSelectedRegion(ALL_OPTION),
    });
  }
  if (selectedType !== ALL_OPTION) {
    activeFilters.push({
      key: 'type',
      label: `拠点種別: ${getLocationTypeLabel(selectedType)}`,
      onRemove: () => setSelectedType(ALL_OPTION),
    });
  }
  if (selectedStatus !== ALL_OPTION) {
    activeFilters.push({
      key: 'status',
      label: `稼働状況: ${getLocationStatusLabel(selectedStatus)}`,
      onRemove: () => setSelectedStatus(ALL_OPTION),
    });
  }
  if (searchQuery.trim() !== '') {
    activeFilters.push({
      key: 'search',
      label: `検索: ${searchQuery.trim()}`,
      onRemove: () => setSearchQuery(''),
    });
  }

  const resetFilters = () => {
    setSelectedRegion(ALL_OPTION);
    setSelectedType(ALL_OPTION);
    setSelectedStatus(ALL_OPTION);
    setSearchQuery('');
  };

  return {
    selectedRegion,
    selectedType,
    selectedStatus,
    searchQuery,
    setSelectedRegion,
    setSelectedType,
    setSelectedStatus,
    setSearchQuery,
    filteredData,
    totalCount: filteredData.length,
    activeFilters,
    resetFilters,
  };
}
