'use client';

// 拠点一覧の絞り込み欄（地域 / 拠点種別 / 稼働状況 / 検索）と、適用中の条件のピル。
// 状態は useLocationFilters が持ち、ここは入力欄だけを描画する。
// 絞り込みを変えたら onChange を呼ぶ（画面本体がページを 1 に戻す）。

import { Search, X } from 'lucide-react';
import { ALL_OPTION, type ActiveLocationFilter, type AllOption, type LocationFilters } from '../hooks/useLocationFilters';
import {
  LOCATION_STATUS_LABELS,
  LOCATION_STATUSES,
  LOCATION_TYPE_LABELS,
  LOCATION_TYPES,
  REGION_LABELS,
  REGIONS,
  type LocationStatus,
  type LocationType,
  type Region,
} from '../types';

const REGION_OPTIONS = [
  { value: ALL_OPTION, label: 'すべて' },
  ...REGIONS.map(region => ({ value: region, label: REGION_LABELS[region] })),
] as const;
const TYPE_OPTIONS = [
  { value: ALL_OPTION, label: 'すべて' },
  ...LOCATION_TYPES.map(type => ({ value: type, label: LOCATION_TYPE_LABELS[type] })),
] as const;
const STATUS_OPTIONS = [
  { value: ALL_OPTION, label: 'すべて' },
  ...LOCATION_STATUSES.map(status => ({ value: status, label: LOCATION_STATUS_LABELS[status] })),
] as const;

interface LocationFilterBarProps {
  filters: LocationFilters;
  /** 適用中の条件（個別解除の処理は画面本体で組み立てたものを渡す） */
  activeFilters: ActiveLocationFilter[];
  /** 絞り込み条件が変わったときに呼ぶ */
  onChange: () => void;
}

export const LocationFilterBar = ({ filters, activeFilters, onChange }: LocationFilterBarProps) => (
  <div className="flex flex-col gap-3">
    <div className="gt-filter-bar" style={{ marginTop: 0 }}>
      <div className="gt-filter-field">
        <label className="gt-field-label">地域</label>
        <select
          className="gt-field gt-field-select"
          value={filters.selectedRegion}
          onChange={(e) => { filters.setSelectedRegion(e.target.value as Region | AllOption); onChange(); }}
        >
          {REGION_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="gt-filter-field">
        <label className="gt-field-label">拠点種別</label>
        <select
          className="gt-field gt-field-select"
          value={filters.selectedType}
          onChange={(e) => { filters.setSelectedType(e.target.value as LocationType | AllOption); onChange(); }}
        >
          {TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="gt-filter-field">
        <label className="gt-field-label">稼働状況</label>
        <select
          className="gt-field gt-field-select"
          value={filters.selectedStatus}
          onChange={(e) => { filters.setSelectedStatus(e.target.value as LocationStatus | AllOption); onChange(); }}
        >
          {STATUS_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="gt-filter-field gt-filter-field-grow">
        <label className="gt-field-label" htmlFor="location-search">検索</label>
        <div className="relative flex items-center">
          <Search size={15} className="text-text-subtle absolute left-3" />
          <input
            id="location-search"
            type="text"
            className="gt-field"
            style={{ paddingLeft: '38px', paddingRight: filters.searchQuery ? '38px' : undefined }}
            placeholder="拠点名、担当者名で検索"
            value={filters.searchQuery}
            onChange={(e) => { filters.setSearchQuery(e.target.value); onChange(); }}
          />
          {filters.searchQuery && (
            <button
              type="button"
              onClick={() => filters.setSearchQuery('')}
              aria-label="検索キーワードをクリア"
              className="absolute right-3 text-text-subtle hover:text-text-main"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>
    </div>

    {/* 適用中の絞り込み。何で絞られているかを一覧の手前で示し、×で1条件ずつ外せるようにする。 */}
    {activeFilters.length > 0 && (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-muted">絞り込み中:</span>
        {activeFilters.map(filter => (
          <span
            key={filter.key}
            className="gt-pill gt-pill-sm gt-pill-accent"
            style={{ paddingRight: '4px' }}
          >
            {filter.label}
            <button
              type="button"
              onClick={filter.onRemove}
              aria-label={`絞り込み「${filter.label}」を解除`}
              className="rounded-full p-0.5 hover:bg-primary/15"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
    )}
  </div>
);
