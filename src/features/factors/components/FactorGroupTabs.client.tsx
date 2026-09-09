'use client';

// 係数の性質で分けるタブ。
// 「エネルギー種別」の1軸に燃料種係数（物理量ベース）と Scope 3 活動係数（活動量ベース）が
// 混在し、エネルギーでないもの（水道・輸送・出張など）まで「エネルギー種別」として並んでいた。
// 群を分けることで、燃料側は「エネルギー種別」の表記がそのまま正確になり、
// Scope 3 側は「活動カテゴリ」と呼べる。振り分けは種別ラベルから決まる（utils/factorGroups.ts）。

import React, { useRef } from 'react';
import clsx from 'clsx';
import {
  FACTOR_GROUPS,
  FACTOR_GROUP_DESCRIPTIONS,
  FACTOR_GROUP_LABELS,
  type FactorGroup,
} from '../utils/factorGroups';

// tab と tabpanel を aria-controls / aria-labelledby で結ぶための id。
// パネルは 1 つで中身だけ差し替えるため、どのタブからも同じ id を指す。
export const FACTOR_TAB_PANEL_ID = 'factor-list-panel';
export const factorTabId = (group: FactorGroup): string => `factor-tab-${group}`;

interface FactorGroupTabsProps {
  activeGroup: FactorGroup;
  /** タブの件数バッジ。絞り込みではなく登録件数を見せる（空のタブに気づけるように）。 */
  groupCounts: Record<FactorGroup, number>;
  onChange: (group: FactorGroup) => void;
}

export const FactorGroupTabs = ({ activeGroup, groupCounts, onChange }: FactorGroupTabsProps) => {
  // 矢印キーで隣のタブへフォーカスを移すために各タブの DOM を持つ（role="tablist" の要件）。
  const tabRefs = useRef<Partial<Record<FactorGroup, HTMLButtonElement | null>>>({});

  // role="tablist" のキーボード操作（WAI-ARIA APG の自動アクティベーション）。
  // Tab キーは選択中のタブとパネルの間を移動し、タブ間の移動は左右キーが担う。
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = FACTOR_GROUPS.indexOf(activeGroup);
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const nextIndex =
      step !== 0
        ? (current + step + FACTOR_GROUPS.length) % FACTOR_GROUPS.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? FACTOR_GROUPS.length - 1
            : null;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextGroup = FACTOR_GROUPS[nextIndex];
    onChange(nextGroup);
    tabRefs.current[nextGroup]?.focus();
  };

  return (
    <>
      <div className="gt-tabs" role="tablist" aria-label="排出係数の種類">
        {FACTOR_GROUPS.map(group => (
          <button
            key={group}
            type="button"
            role="tab"
            id={factorTabId(group)}
            ref={(element) => { tabRefs.current[group] = element; }}
            aria-selected={group === activeGroup}
            aria-controls={FACTOR_TAB_PANEL_ID}
            // 選択中のタブだけを Tab キーの停止点にする（tablist 内は左右キーで移動する）。
            tabIndex={group === activeGroup ? 0 : -1}
            className={clsx('gt-tab', { 'gt-tab-active': group === activeGroup })}
            onClick={() => onChange(group)}
            onKeyDown={handleTabKeyDown}
            title={FACTOR_GROUP_DESCRIPTIONS[group]}
          >
            {FACTOR_GROUP_LABELS[group]}
            <span className="gt-tab-count">{groupCounts[group]}</span>
          </button>
        ))}
      </div>
      <p className="gt-card-sub" style={{ marginTop: '8px' }}>
        {FACTOR_GROUP_DESCRIPTIONS[activeGroup]}
      </p>
    </>
  );
};
