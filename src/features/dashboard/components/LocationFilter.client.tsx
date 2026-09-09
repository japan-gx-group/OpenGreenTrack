'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { DashboardLocationOption } from '../services/dashboardService';

type LocationFilterProps = {
  options: DashboardLocationOption[];
  /** null = 全拠点 */
  selectedId: string | null;
  onSelect: (locationId: string | null) => void;
  /** ポップオーバーを開いたときに呼ぶ（拠点一覧の再取得など）。省略可。 */
  onOpen?: () => void;
};

// 画面見出しの右肩に置く拠点絞り込みボタン＋ポップオーバー（デザイン正）。
// 選択中はボタンを淡緑の面に切り替えて、絞り込み中であることを一目で分かるようにする。
export const LocationFilter = ({ options, selectedId, onSelect, onOpen }: LocationFilterProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // ポップオーバー外のクリックで閉じる。
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  // Escape で閉じ、トリガーボタンへフォーカスを戻す（キーボード操作者が現在位置を見失わないように）。
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const selected = options.find(option => option.id === selectedId) ?? null;

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      onOpen?.();
    }
  };

  const handlePick = (locationId: string | null) => {
    onSelect(locationId);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="gt-btn"
        style={{
          gap: '9px',
          backgroundColor: selected ? 'var(--color-primary-light)' : 'var(--color-bg-card)',
          color: selected ? 'var(--color-primary-dark)' : 'var(--color-text-main)',
        }}
      >
        <Building2 size={15} strokeWidth={1.85} style={{ opacity: 0.7, flex: 'none' }} />
        {selected ? selected.name : 'すべての拠点'}
        <ChevronDown size={13} strokeWidth={2} style={{ opacity: 0.5, flex: 'none' }} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="gt-menu gt-scroll"
          style={{
            left: 0,
            minWidth: '244px',
            // 拠点数が多い場合のあふれ対策。
            maxHeight: '60vh',
            overflowY: 'auto',
          }}
        >
          <div className="gt-menu-label">拠点で絞り込む</div>
          <button
            type="button"
            role="option"
            aria-selected={selectedId === null}
            onClick={() => handlePick(null)}
            className={clsx('gt-menuitem', { 'gt-menuitem-selected': selectedId === null })}
          >
            <span style={{ width: '14px', flex: 'none', color: 'var(--color-primary)' }}>
              {selectedId === null && <Check size={13} strokeWidth={2.6} />}
            </span>
            <span style={{ flex: 1 }}>すべての拠点</span>
          </button>
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === selectedId}
              onClick={() => handlePick(option.id)}
              className={clsx('gt-menuitem', { 'gt-menuitem-selected': option.id === selectedId })}
            >
              <span style={{ width: '14px', flex: 'none', color: 'var(--color-primary)' }}>
                {option.id === selectedId && <Check size={13} strokeWidth={2.6} />}
              </span>
              <span style={{ flex: 1 }}>{option.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
