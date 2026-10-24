// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyDown, render, click } from '@/lib/testing/render';
import type { LocationRecord } from '../../types';
import { LocationTable } from '../LocationTable.client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('LocationTable row menu', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('closes on Escape and restores focus to its trigger', () => {
    const menuTriggerRef = { current: null };
    const row: LocationRecord = {
      id: 'location-1', name: 'HQ', region: 'kanto', type: 'headquarters', person: '', status: 'active',
    };
    const secondRow: LocationRecord = { ...row, id: 'location-2', name: 'Branch' };
    const { container, unmount } = render(
      <LocationTable rows={[row, secondRow]} totalCount={2} isBusy={false} hasFetchedOnce menuTriggerRef={menuTriggerRef}
        onResetFilters={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    const trigger = container.querySelectorAll('button[aria-haspopup="menu"]')[1] as HTMLButtonElement;
    click(trigger);
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(menuTriggerRef.current).toBe(trigger);

    keyDown(document, 'Escape');

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    unmount();
  });
});
