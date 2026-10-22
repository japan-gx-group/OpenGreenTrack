// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '@/lib/testing/render';
import type { LocationFilters } from '../../hooks/useLocationFilters';
import { LocationFilterBar } from '../LocationFilterBar.client';

describe('LocationFilterBar search clear', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('resets pagination when the search query is cleared', () => {
    const setSearchQuery = vi.fn();
    const onChange = vi.fn();
    const filters = {
      selectedRegion: 'all', selectedType: 'all', selectedStatus: 'all', searchQuery: '支社',
      setSelectedRegion: vi.fn(), setSelectedType: vi.fn(), setSelectedStatus: vi.fn(), setSearchQuery,
    } as unknown as LocationFilters;
    const { container, unmount } = render(
      <LocationFilterBar filters={filters} activeFilters={[]} onChange={onChange} />,
    );

    click(container.querySelector('button[aria-label="検索キーワードをクリア"]')!);

    expect(setSearchQuery).toHaveBeenCalledWith('');
    expect(onChange).toHaveBeenCalledTimes(1);
    unmount();
  });
});

// 絞り込みの各ラベルが入力欄に結び付いているか（label の htmlFor と select / input の id の対応）を検証する。
// 結び付いていないとラベルをクリックしても入力欄にフォーカスが移らず、スクリーンリーダーにも項目名が読まれない。
describe('LocationFilterBar ラベルの関連付け', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('地域・拠点種別・稼働状況・検索のラベルが htmlFor で対応する入力欄を指す', () => {
    const filters = {
      selectedRegion: 'all', selectedType: 'all', selectedStatus: 'all', searchQuery: '',
      setSelectedRegion: vi.fn(), setSelectedType: vi.fn(), setSelectedStatus: vi.fn(), setSearchQuery: vi.fn(),
    } as unknown as LocationFilters;
    const { container, unmount } = render(
      <LocationFilterBar filters={filters} activeFilters={[]} onChange={vi.fn()} />,
    );

    const labels = Array.from(container.querySelectorAll('label'));
    expect(labels.map((label) => label.textContent?.trim())).toEqual(['地域', '拠点種別', '稼働状況', '検索']);
    for (const label of labels) {
      const name = label.textContent?.trim();
      expect(label.htmlFor, `ラベル「${name}」に htmlFor が無い`).not.toBe('');
      const control = container.querySelector(`#${CSS.escape(label.htmlFor)}`);
      expect(
        control instanceof HTMLInputElement || control instanceof HTMLSelectElement,
        `ラベル「${name}」の参照先 #${label.htmlFor} が入力欄ではない`,
      ).toBe(true);
    }
    unmount();
  });
});
