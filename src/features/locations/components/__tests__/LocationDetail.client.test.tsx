// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { getLocationById } from '../../services/locationService';
import { getLocationDetailData } from '../../services/locationDetailService';
import { LocationDetail } from '../LocationDetail.client';

vi.mock('../../services/locationService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/locationService')>()),
  getLocationById: vi.fn(),
}));
vi.mock('../../services/locationDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/locationDetailService')>()),
  getLocationDetailData: vi.fn(),
}));
vi.mock('@/hooks/useFiscalYear', () => ({
  useFiscalYear: () => ({ fiscalYear: '2025', fiscalYearId: 'year-id', fiscalYears: [{ id: 'year-id', label: '2025年度', year: '2025', startDate: '2025-04-01', endDate: '2026-03-31' }], isLoading: false }),
}));

describe('LocationDetail invalid ids', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('shows Not Found without issuing location or activity queries for a malformed UUID', () => {
    const view = render(<LocationDetail locationId="not-a-uuid" />);

    expect(view.container.textContent).toContain('拠点が見つかりません');
    expect(getLocationById).not.toHaveBeenCalled();
    expect(getLocationDetailData).not.toHaveBeenCalled();
    view.unmount();
  });
});
