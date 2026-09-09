'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import {
  filterSearchableOptions,
  type SearchableSelectOption,
} from './searchableSelectFilter';

export type { SearchableSelectOption };

interface SearchableSelectProps {
  id?: string;
  options: SearchableSelectOption[];
  /** 選択中の value。null = 未選択 */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 補足説明の要素 id。スクリーンリーダーに入力欄と紐づけて読ませる。 */
  ariaDescribedBy?: string;
  /**
   * 検索キーワードの変更通知。サーバーサイド検索（インクリメンタル）と組み合わせる場合、
   * 親がこれを受けて options を差し替える（debounce は親側で行う）。
   */
  onQueryChange?: (query: string) => void;
  /**
   * true のときクライアント側の絞り込みを行わず、options をそのまま表示する。
   * サーバーサイドで絞り込み済みの候補（例: IDEA 製品検索の ilike + limit）に使う。
   */
  disableClientFilter?: boolean;
  /** 候補が0件のときの表示文言（例: 検索中の案内）。省略時は既定の文言。 */
  emptyMessage?: string;
}

/**
 * テキスト絞り込み付きのセレクト。供給事業者（数百件）のように
 * ネイティブ <select> では探しづらい長い選択肢リスト用。
 * 依存ライブラリなし・キーボード操作（↑↓ Enter Escape）対応。
 */
export const SearchableSelect = ({
  id,
  options,
  value,
  onChange,
  placeholder = '検索して選択',
  disabled = false,
  ariaDescribedBy,
  onQueryChange,
  disableClientFilter = false,
  emptyMessage,
}: SearchableSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // キーワードの更新は必ずここを通し、サーバーサイド検索の親へも同じ値を通知する。
  const updateQuery = (next: string) => {
    setQuery(next);
    onQueryChange?.(next);
  };

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(
    () => (disableClientFilter ? [...options] : filterSearchableOptions(options, query)),
    [options, query, disableClientFilter],
  );

  // 外側クリックで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery('');
        onQueryChange?.('');
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, onQueryChange]);

  // ハイライト行を可視範囲に保つ
  useEffect(() => {
    if (!isOpen) return;
    const item = listRef.current?.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isOpen]);

  const select = (option: SearchableSelectOption) => {
    onChange(option.value);
    setIsOpen(false);
    updateQuery('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIsOpen(true);
      setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen && filtered[highlightIndex]) {
        select(filtered[highlightIndex]);
      }
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      updateQuery('');
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={`${id ?? 'searchable-select'}-listbox`}
          aria-autocomplete="list"
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          value={isOpen ? query : selectedOption?.label ?? ''}
          placeholder={selectedOption ? selectedOption.label : placeholder}
          onFocus={() => {
            setIsOpen(true);
            updateQuery('');
            setHighlightIndex(0);
          }}
          onChange={(event) => {
            updateQuery(event.target.value);
            setIsOpen(true);
            setHighlightIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className="gt-field pr-14"
        />
        <span className="absolute inset-y-0 right-2 flex items-center gap-1">
          {selectedOption && !disabled && (
            <button
              type="button"
              aria-label="選択を解除"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(null);
                updateQuery('');
              }}
              className="text-text-muted hover:text-text-main"
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown size={16} className="text-text-muted" />
        </span>
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          id={`${id ?? 'searchable-select'}-listbox`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border-light bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">{emptyMessage ?? '該当する候補がありません'}</li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(option)}
                  onMouseEnter={() => setHighlightIndex(index)}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    index === highlightIndex ? 'bg-primary-light text-primary-dark' : 'text-text-main'
                  } ${option.value === value ? 'font-semibold' : ''}`}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
