'use client';

// 排出係数一覧の絞り込み欄（適用年度 / 係数種別 / 種別 / 供給事業者 / データソース / 検索）。
// 状態と候補リストは useFactorFilters が持ち、ここは入力欄だけを描画する。
// 絞り込みを変えたら onChange を呼ぶ（画面本体がページを 1 に戻す）。

import { Search, X } from 'lucide-react';
import type { FactorFilters } from '../hooks/useFactorFilters';
import { FACTOR_GROUP_ENERGY_FIELD_LABELS } from '../utils/factorGroups';

interface FactorFilterBarProps {
  filters: FactorFilters;
  /** 絞り込み条件が変わったときに呼ぶ */
  onChange: () => void;
}

export const FactorFilterBar = ({ filters, onChange }: FactorFilterBarProps) => (
  <div className="gt-filter-bar">
      <div className="gt-filter-field">
        <label className="gt-field-label">適用年度</label>
        <select
          className="gt-field gt-field-select"
          value={filters.selectedYear}
          onChange={(e) => {
            filters.setSelectedYear(e.target.value);
            onChange();
          }}
        >
          <option value="すべて">すべて（全年度）</option>
          {filters.availableYears.map(year => (
            <option key={year} value={year}>{year}年度</option>
          ))}
        </select>
      </div>
      <div className="gt-filter-field">
        <label className="gt-field-label">係数種別</label>
        <select
          className="gt-field gt-field-select"
          value={filters.selectedType}
          onChange={(e) => { filters.setSelectedType(e.target.value); onChange(); }}
        >
          <option value="すべて">すべて</option>
          <option value="標準">標準係数 (省庁公表)</option>
          <option value="カスタム">カスタム係数 (自社・サプライヤー)</option>
        </select>
      </div>
      <div className="gt-filter-field">
        <label className="gt-field-label">{FACTOR_GROUP_ENERGY_FIELD_LABELS[filters.activeGroup]}</label>
        <select
          className="gt-field gt-field-select"
          value={filters.selectedEnergy}
          onChange={(e) => { filters.setSelectedEnergy(e.target.value); onChange(); }}
        >
          <option value="すべて">すべて</option>
          {filters.energyOptionsInGroup.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
      <div className="gt-filter-field">
        <label className="gt-field-label">供給事業者</label>
        <select
          className="gt-field gt-field-select"
          value={filters.selectedProvider}
          onChange={(e) => { filters.setSelectedProvider(e.target.value); onChange(); }}
        >
          {filters.uniqueProviders.map(provider => (
             <option key={provider} value={provider}>{provider}</option>
          ))}
        </select>
      </div>
      <div className="gt-filter-field">
        <label className="gt-field-label">データソース</label>
        <select
          className="gt-field gt-field-select"
          value={filters.selectedSource}
          onChange={(e) => { filters.setSelectedSource(e.target.value); onChange(); }}
        >
          {filters.uniqueSources.map(src => (
             <option key={src} value={src}>{src}</option>
          ))}
        </select>
      </div>

    {/* Keyword Search Input */}
    <div className="gt-filter-field gt-filter-field-grow">
      <label className="gt-field-label" htmlFor="factor-search">検索</label>
      <div className="relative flex items-center">
        <Search size={15} className="absolute left-3 text-text-subtle" />
        <input
          id="factor-search"
          type="text"
          placeholder="係数名、供給事業者、メニュー、データソース名で検索"
          className="gt-field"
          style={{ paddingLeft: '38px', paddingRight: filters.searchQuery ? '38px' : undefined }}
          value={filters.searchQuery}
          onChange={(e) => { filters.setSearchQuery(e.target.value); onChange(); }}
        />
        {filters.searchQuery && (
          <button
            type="button"
            onClick={() => filters.setSearchQuery('')}
            aria-label="検索キーワードをクリア"
            style={{ position: 'absolute', right: '12px' }}
            className="text-text-subtle hover:text-text-main"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  </div>
);
