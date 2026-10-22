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
