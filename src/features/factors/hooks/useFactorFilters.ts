'use client';

// 排出係数一覧の絞り込み（タブ・適用年度・区分・種別・供給事業者・ソース・検索）と、
// その候補リストの導出。ページングはここでは扱わない（絞り込みを変えたときに
// 1 ページ目へ戻すのは呼び出し側の責務）。

import { useMemo, useState } from 'react';
import type { EmissionFactor } from '../services/factorService';
import { energyLabelsInGroup, factorGroupOf, type FactorGroup } from '../utils/factorGroups';
import { energyTypeOptions } from '../utils/energyTypeOptions';

type YearFilterState = {
  baseFiscalYear: string;
  value: string;
};

export interface FactorFilters {
  activeGroup: FactorGroup;
  /** タブの件数バッジ用。絞り込みではなく登録件数（空のタブに気づけるように）。 */
  groupCounts: Record<FactorGroup, number>;
  selectedYear: string;
  selectedType: string;
  selectedEnergy: string;
  selectedProvider: string;
  selectedSource: string;
  searchQuery: string;
  /** 適用年度の候補（降順。先頭が最新） */
  availableYears: number[];
  /** 種別フィルタの候補。開いているタブの群だけに絞る。 */
  energyOptionsInGroup: EmissionFactor['energyType'][];
  uniqueProviders: string[];
  uniqueSources: string[];
  /** 絞り込み後の一覧（ページング前） */
  filteredData: EmissionFactor[];
  totalCount: number;
  setSelectedYear: (value: string) => void;
  setSelectedType: (value: string) => void;
  setSelectedEnergy: (value: string) => void;
  setSelectedProvider: (value: string) => void;
  setSelectedSource: (value: string) => void;
  setSearchQuery: (value: string) => void;
  /** すべての絞り込みを初期状態に戻す（年度は「すべて」） */
  resetFilters: () => void;
  /** タブ切替。群ごとに候補が違う種別・供給事業者の絞り込みは持ち越すと必ず0件になるため解除する。 */
  changeGroup: (group: FactorGroup) => void;
}

export function useFactorFilters(database: EmissionFactor[], fiscalYear: string): FactorFilters {
  // 係数の性質による2分割。エネルギー・燃料係数と Scope 3 活動係数は
  // 数える対象（物理量 / 活動量）が違うため、同じ表に混ぜず群ごとのタブで見せる。
  const [activeGroup, setActiveGroup] = useState<FactorGroup>('fuel');

  // 年度フィルタは会計年度の初期値に追従する。ユーザーが選んだ値は、その時点の会計年度と
  // 組で持ち、会計年度が切り替わったら新しい会計年度に戻す。
  const [yearFilter, setYearFilter] = useState<YearFilterState>({
    baseFiscalYear: fiscalYear,
    value: fiscalYear,
  });
  const selectedYear = yearFilter.baseFiscalYear === fiscalYear ? yearFilter.value : fiscalYear;
  const [selectedType, setSelectedType] = useState<string>('すべて');
  const [selectedEnergy, setSelectedEnergy] = useState<string>('すべて');
  const [selectedProvider, setSelectedProvider] = useState<string>('すべて');
  const [selectedSource, setSelectedSource] = useState<string>('すべて');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 供給事業者フィルタ（事業者別係数のみ providerName を持つ。事業者に紐づかない係数は「事業者なし」で絞れる）
  // 候補は開いているタブの群から作る（事業者別係数は燃料群にしか無いため、
  // Scope 3 タブに選んでも必ず0件になる事業者名を並べない）。
  const uniqueProviders = useMemo(() => {
    const providers = Array.from(
      new Set(
        database
          .filter(item => factorGroupOf(item.energyType) === activeGroup)
          .map(item => item.providerName)
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((a, b) => a.localeCompare(b, 'ja'));
    return ['すべて', '事業者なし', ...providers];
  }, [database, activeGroup]);

  const uniqueSources = useMemo(() => {
    return ['すべて', ...Array.from(new Set(database.map(item => item.source)))];
  }, [database]);

  const groupCounts = useMemo(() => {
    const counts: Record<FactorGroup, number> = { fuel: 0, activity: 0 };
    for (const item of database) {
      counts[factorGroupOf(item.energyType)] += 1;
    }
    return counts;
  }, [database]);

  const energyOptionsInGroup = useMemo(
    () => energyLabelsInGroup(activeGroup, energyTypeOptions),
    [activeGroup],
  );

  const availableYears = useMemo(() => {
    const years = new Set(database.map(item => item.applicableYear));
    // fiscalYear が空文字のうちは Number('') === 0 で「0年度」が選択肢に混ざるため、4桁の年のみ加える。
    if (/^\d{4}$/.test(fiscalYear)) {
      years.add(Number(fiscalYear));
    }

    return Array.from(years).sort((a, b) => b - a);
  }, [database, fiscalYear]);

  const filteredData = useMemo(() => {
    // 0. Factor Group Tab（エネルギー・燃料係数 / Scope 3 活動係数）
    let result = database.filter(item => factorGroupOf(item.energyType) === activeGroup);

    // 1. Year Filter
    if (selectedYear !== 'すべて') {
      result = result.filter(item => item.applicableYear === parseInt(selectedYear, 10));
    }

    // 2. Custom/Standard Type Filter
    if (selectedType === 'カスタム') {
      result = result.filter(item => item.isCustom);
    } else if (selectedType === '標準') {
      result = result.filter(item => !item.isCustom);
    }

    // 3. Energy Type Filter
    if (selectedEnergy !== 'すべて') {
      result = result.filter(item => item.energyType === selectedEnergy);
    }

    // 4. Provider Filter
    if (selectedProvider === '事業者なし') {
      result = result.filter(item => !item.providerName);
    } else if (selectedProvider !== 'すべて') {
      result = result.filter(item => item.providerName === selectedProvider);
    }

    // 5. Source Filter
    if (selectedSource !== 'すべて') {
      result = result.filter(item => item.source === selectedSource);
    }

    // 6. Text Search query filter
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase();
      result = result.filter(item =>
        item.name.toLowerCase().includes(query) ||
        (item.providerName ?? '').toLowerCase().includes(query) ||
        (item.menuName ?? '').toLowerCase().includes(query) ||
        item.source.toLowerCase().includes(query)
      );
    }

    return result;
  }, [database, activeGroup, selectedYear, selectedType, selectedEnergy, selectedProvider, selectedSource, searchQuery]);

  const setSelectedYear = (value: string) => {
    setYearFilter({ baseFiscalYear: fiscalYear, value });
  };

  const resetFilters = () => {
    setYearFilter({ baseFiscalYear: fiscalYear, value: 'すべて' });
    setSelectedType('すべて');
    setSelectedEnergy('すべて');
    setSelectedProvider('すべて');
    setSelectedSource('すべて');
    setSearchQuery('');
  };

  // 種別フィルタは群ごとに候補が違うため、持ち越すと必ず0件になる。
  // 供給事業者フィルタも同様（事業者別係数は電気・ガス・熱＝燃料群にしか無いため、
  // 事業者を選んだまま Scope 3 タブへ移ると必ず0件になる）。両方解除する。
  const changeGroup = (group: FactorGroup) => {
    setActiveGroup(group);
    setSelectedEnergy('すべて');
    setSelectedProvider('すべて');
  };

  return {
    activeGroup,
    groupCounts,
    selectedYear,
    selectedType,
    selectedEnergy,
    selectedProvider,
    selectedSource,
    searchQuery,
    availableYears,
    energyOptionsInGroup,
    uniqueProviders,
    uniqueSources,
    filteredData,
    totalCount: filteredData.length,
    setSelectedYear,
    setSelectedType,
    setSelectedEnergy,
    setSelectedProvider,
    setSelectedSource,
    setSearchQuery,
    resetFilters,
    changeGroup,
  };
}
