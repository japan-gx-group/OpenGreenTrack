'use client';

// 対象会計年度のセレクタ（デザイン正）。ネイティブ <select> ではなく
// 「年度ラベル＋期間」を並べたドロップダウンにして、期間まで見て選べるようにする。

import { useState } from 'react';
import { Calendar, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { isCurrentFiscalYear } from '@/lib/fiscal-year/fiscalYearPeriod';

const formatRange = (startDate: string, endDate: string): string => {
  const toYm = (value: string) => value.slice(0, 7).replace('-', '/');
  return `${toYm(startDate)} – ${toYm(endDate)}`;
};

export const FiscalYearMenu = () => {
  const { fiscalYearId, fiscalYears, isLoading, setFiscalYearId } = useFiscalYear();
  const [isOpen, setIsOpen] = useState(false);

  const selected = fiscalYears.find(year => year.id === fiscalYearId) ?? null;
  const isDisabled = isLoading || fiscalYears.length === 0;

  return (
    <div style={{ position: 'relative' }}>
      {isOpen && (
        <div className="fixed inset-0" style={{ zIndex: 39 }} aria-hidden="true" onClick={() => setIsOpen(false)} />
      )}
      <button
        type="button"
        className="gt-btn"
        /* E2Eが年度切替に使う目印。見た目に依存しない指定にしておく。 */
        data-testid="fiscal-year-menu"
        disabled={isDisabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(previous => !previous)}
        style={{ gap: '9px' }}
      >
        <Calendar size={15} strokeWidth={1.9} style={{ color: 'var(--color-text-muted)', flex: 'none' }} />
        {selected ? (
          <>
            <span style={{ fontWeight: 600 }}>{selected.label}</span>
            <span style={{ color: 'var(--color-text-subtle)' }}>
              {formatRange(selected.startDate, selected.endDate)}
            </span>
          </>
        ) : (
          <span style={{ fontWeight: 600 }}>{isLoading ? '読み込み中...' : '年度なし'}</span>
        )}
        <ChevronDown size={13} strokeWidth={2} style={{ color: 'var(--color-text-subtle)', flex: 'none' }} />
      </button>

      {isOpen && (
        <div className="gt-menu" style={{ right: 0, minWidth: '244px' }} role="listbox">
          <div className="gt-menu-label">対象年度</div>
          {fiscalYears.map(year => {
            const isSelected = year.id === fiscalYearId;
            return (
              <button
                key={year.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={clsx('gt-menuitem', { 'gt-menuitem-selected': isSelected })}
                onClick={() => {
                  setFiscalYearId(year.id);
                  setIsOpen(false);
                }}
              >
                <span style={{ width: '14px', flex: 'none', color: 'var(--color-primary)' }}>
                  {isSelected && <Check size={13} strokeWidth={2.6} />}
                </span>
                <span style={{ flex: 1 }}>
                  {year.label}
                  {/* 「現在」は今日が期間内かで導出する。既定の選択年度（最新年度）とは別の概念 */}
                  {isCurrentFiscalYear(year) && <span style={{ color: 'var(--color-text-subtle)' }}>・現在</span>}
                </span>
                <span style={{ fontSize: '11.5px', color: 'var(--color-text-subtle)' }}>
                  {formatRange(year.startDate, year.endDate)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
