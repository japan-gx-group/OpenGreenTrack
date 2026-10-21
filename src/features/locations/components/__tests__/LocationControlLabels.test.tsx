// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import { LocationFilterBar } from '../LocationFilterBar.client';
import { LocationFormModal } from '../LocationFormModal.client';
import type { LocationFormController } from '../../hooks/useLocationForm';

describe('location form control labels', () => {
  it('associates each filter and form label with its control', () => {
    const filters = {
      selectedRegion: 'all', selectedType: 'all', selectedStatus: 'all', searchQuery: '',
      setSelectedRegion: () => {}, setSelectedType: () => {}, setSelectedStatus: () => {}, setSearchQuery: () => {},
    } as unknown as React.ComponentProps<typeof LocationFilterBar>['filters'];
    const form = {
      isModalOpen: true, editingLocationId: null,
      values: { name: '', region: 'Kanto', type: 'office', person: '', status: 'active' },
      setValues: () => {}, isSaving: false, openAdd: () => {}, openEdit: () => {}, close: () => {}, submit: async () => {},
    } as unknown as LocationFormController;
    const rendered = render(<><LocationFilterBar filters={filters} activeFilters={[]} onChange={() => {}} /><LocationFormModal form={form} returnFocusRef={{ current: null }} /></>);
    const labels = Array.from(rendered.container.querySelectorAll('label'));
    for (const label of labels) {
      expect(label.htmlFor, `Label "${label.textContent?.trim()}" must reference a control`).not.toBe('');
      expect(rendered.container.querySelector(`#${CSS.escape(label.htmlFor)}`), `Label "${label.textContent?.trim()}" target must exist`).not.toBeNull();
    }
    rendered.unmount();
  });
});
