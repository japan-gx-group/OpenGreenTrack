'use client';

// 「地域別拠点分布」カード。地域カードをクリックするとその地域で一覧を絞り込める。

import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { ALL_OPTION, type AllOption } from '../hooks/useLocationFilters';
import { REGIONS, getRegionLabel, type LocationRecord, type Region } from '../types';

interface LocationRegionCardsProps {
  database: LocationRecord[];
  selectedRegion: Region | AllOption;
  /** 地域フィルターと連動する。選択中の地域を再度押すと ALL_OPTION が渡る */
  onSelectRegion: (region: Region | AllOption) => void;
}

export const LocationRegionCards = ({ database, selectedRegion, onSelectRegion }: LocationRegionCardsProps) => {
  // Dynamic regional counts based on current active database state
  const regionalCounts = useMemo(() => {
    const counts = Object.fromEntries(REGIONS.map(region => [region, 0])) as Record<Region, number>;
    database.forEach(item => {
      counts[item.region]++;
    });
    return counts;
  }, [database]);

  // 全地域を件数の多い順に並べたカード用リスト。0件の地域も「北海道 0」のように残し、
  // 全地域が漏れなく計上されていることを一目で確認できるようにする（0件が消えて見落とすのを防ぐ）。
  const regionalDistribution = useMemo(
    () =>
      REGIONS.map(region => ({ region, count: regionalCounts[region] }))
        .sort((a, b) => b.count - a.count),
    [regionalCounts],
  );

  return (
    <Card className="lg:col-span-3 flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="gt-card-title">地域別拠点分布</h2>
        <span className="text-xs text-text-muted">全 {database.length} 拠点</span>
      </div>
      {database.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-text-muted">
          拠点データがありません
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 animate-fade-in">
          {regionalDistribution.map(({ region, count }) => {
            const isActive = selectedRegion === region;
            return (
              <button
                key={region}
                type="button"
                // カードをクリックするとその地域で絞り込み、選択中の地域を再度押すと解除する（地域フィルターと連動）。
                onClick={() => onSelectRegion(isActive ? ALL_OPTION : region)}
                aria-pressed={isActive}
                className={`flex flex-col items-center justify-center gap-1 rounded-md px-3 py-4 bg-chart-track border transition-colors ${isActive ? 'border-primary' : 'border-transparent hover:border-border'}`}
              >
                <span className="font-serif font-semibold text-2xl leading-none text-primary">{count}</span>
                <span className="text-xs text-text-muted">{getRegionLabel(region)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
};
