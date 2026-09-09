// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import type { EmissionFactor } from '../../services/factorService';
import { useFactorFilters, type FactorFilters } from '../useFactorFilters';

// useFactorFilters の回帰テスト。
// 「タブは群で絞る」「タブ切替で種別・供給事業者の絞り込みが解除される」
// 「供給事業者の候補は開いているタブの群から作る」「年度の絞り込みは会計年度に追従する」を固定する。

const factor = (overrides: Partial<EmissionFactor> & { id: string; name: string }): EmissionFactor => ({
  energyType: '電気',
  scope: 'Scope 2',
  factorValue: 0.0004,
  unit: 't-CO2/kWh',
  applicableYear: 2026,
  region: '全国',
  source: '環境省',
  status: '有効',
  isCustom: false,
  ...overrides,
});

const database: EmissionFactor[] = [
  factor({ id: 'e1', name: '電気（全国平均）' }),
  factor({ id: 'e2', name: '電気（A電力）', providerName: 'A電力', menuName: '標準メニュー' }),
  factor({ id: 'e3', name: '電気（前年度）', applicableYear: 2025 }),
  factor({ id: 'c1', name: '電気 自社PPA', isCustom: true, source: '自社設定' }),
  factor({ id: 'w1', name: '廃棄物（一般）', energyType: '廃棄物', scope: 'Scope 3', unit: 't-CO2/t' }),
];

let latest: FactorFilters;
// レンダリング中にモジュール変数へ直接代入すると react-hooks/globals に弾かれるため、関数を経由して受け取る。
const capture = (value: FactorFilters) => { latest = value; };

const Probe = ({ fiscalYear }: { fiscalYear: string }) => {
  capture(useFactorFilters(database, fiscalYear));
  return null;
};

const names = (): string[] => latest.filteredData.map(item => item.name);

describe('useFactorFilters', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('既定では燃料群のタブと会計年度で絞り込む', () => {
    const { unmount } = render(<Probe fiscalYear="2026" />);
    expect(latest.activeGroup).toBe('fuel');
    expect(latest.selectedYear).toBe('2026');
    expect(names()).toEqual(['電気（全国平均）', '電気（A電力）', '電気 自社PPA']);
    expect(latest.totalCount).toBe(3);
    expect(latest.groupCounts).toEqual({ fuel: 4, activity: 1 });
    unmount();
  });

  it('年度を「すべて」にすると全年度が出て、会計年度が変わると年度の絞り込みは新しい会計年度へ戻る', () => {
    const { rerender, unmount } = render(<Probe fiscalYear="2026" />);
    act(() => latest.setSelectedYear('すべて'));
    expect(names()).toContain('電気（前年度）');

    rerender(<Probe fiscalYear="2025" />);
    expect(latest.selectedYear).toBe('2025');
    expect(names()).toEqual(['電気（前年度）']);
    unmount();
  });

  it('適用年度の候補は登録係数の年度と会計年度を降順に並べ、会計年度が未確定（空文字）なら 0 年度を混ぜない', () => {
    const { rerender, unmount } = render(<Probe fiscalYear="2027" />);
    expect(latest.availableYears).toEqual([2027, 2026, 2025]);

    rerender(<Probe fiscalYear="" />);
    expect(latest.availableYears).toEqual([2026, 2025]);
    unmount();
  });

  it('区分・供給事業者・ソース・検索で絞り込める', () => {
    const { unmount } = render(<Probe fiscalYear="2026" />);

    act(() => latest.setSelectedType('カスタム'));
    expect(names()).toEqual(['電気 自社PPA']);
    act(() => latest.setSelectedType('すべて'));

    act(() => latest.setSelectedProvider('A電力'));
    expect(names()).toEqual(['電気（A電力）']);
    act(() => latest.setSelectedProvider('事業者なし'));
    expect(names()).toEqual(['電気（全国平均）', '電気 自社PPA']);
    act(() => latest.setSelectedProvider('すべて'));

    act(() => latest.setSelectedSource('自社設定'));
    expect(names()).toEqual(['電気 自社PPA']);
    act(() => latest.setSelectedSource('すべて'));

    // 検索は係数名・供給事業者・メニュー名・ソースに当たる（大文字小文字を区別しない）
    act(() => latest.setSearchQuery('標準メニュー'));
    expect(names()).toEqual(['電気（A電力）']);
    act(() => latest.setSearchQuery('ppa'));
    expect(names()).toEqual(['電気 自社PPA']);
    unmount();
  });

  it('供給事業者の候補は開いているタブの群から作り、Scope 3 タブでは事業者名を並べない', () => {
    const { unmount } = render(<Probe fiscalYear="2026" />);
    expect(latest.uniqueProviders).toEqual(['すべて', '事業者なし', 'A電力']);
    expect(latest.energyOptionsInGroup).toContain('電気');
    expect(latest.energyOptionsInGroup).not.toContain('廃棄物');

    act(() => latest.changeGroup('activity'));
    expect(latest.uniqueProviders).toEqual(['すべて', '事業者なし']);
    expect(latest.energyOptionsInGroup).toContain('廃棄物');
    expect(names()).toEqual(['廃棄物（一般）']);
    unmount();
  });

  it('タブを切り替えると種別と供給事業者の絞り込みは解除され、それ以外は残る', () => {
    const { unmount } = render(<Probe fiscalYear="2026" />);
    act(() => {
      latest.setSelectedEnergy('電気');
      latest.setSelectedProvider('A電力');
      latest.setSelectedType('標準');
      latest.setSearchQuery('廃棄');
    });

    act(() => latest.changeGroup('activity'));
    expect(latest.selectedEnergy).toBe('すべて');
    expect(latest.selectedProvider).toBe('すべて');
    expect(latest.selectedType).toBe('標準');
    expect(latest.searchQuery).toBe('廃棄');
    expect(names()).toEqual(['廃棄物（一般）']);
    unmount();
  });

  it('resetFilters は年度を「すべて」に、それ以外を初期値に戻す', () => {
    const { unmount } = render(<Probe fiscalYear="2026" />);
    act(() => {
      latest.setSelectedType('カスタム');
      latest.setSelectedEnergy('電気');
      latest.setSearchQuery('x');
    });
    act(() => latest.resetFilters());
    expect(latest.selectedYear).toBe('すべて');
    expect(latest.selectedType).toBe('すべて');
    expect(latest.selectedEnergy).toBe('すべて');
    expect(latest.searchQuery).toBe('');
    expect(latest.totalCount).toBe(4);
    unmount();
  });
});
