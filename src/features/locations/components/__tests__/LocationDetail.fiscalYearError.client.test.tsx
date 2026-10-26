// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { getLocationById } from '../../services/locationService';
import { LocationDetail } from '../LocationDetail.client';

vi.mock('@/hooks/useFiscalYear', () => ({ useFiscalYear: vi.fn() }));
vi.mock('../../services/locationService', () => ({ getLocationById: vi.fn() }));
vi.mock('../../services/locationDetailService', () => ({ getLocationDetailData: vi.fn() }));

const refresh = vi.fn();

describe('LocationDetail fiscal year loading failure', () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('shows a retry action instead of directing users to add a fiscal year', async () => {
    vi.mocked(useFiscalYear).mockReturnValue({
      fiscalYear: '', fiscalYearId: null, fiscalYears: [], isLoading: false,
      fiscalYearError: true, refresh, setFiscalYearId: vi.fn(),
    });
    vi.mocked(getLocationById).mockResolvedValue({
      id: 'loc-1', name: 'Office', region: 'Kanto', type: 'headquarters', person: '', status: 'active',
    });

    const rendered = render(<LocationDetail locationId="loc-1" />);
    await Promise.resolve();
    await Promise.resolve();

    expect(rendered.container.textContent).toContain('年度を取得できませんでした');
    expect(rendered.container.textContent).not.toContain('算定年度が登録されていません');
    expect(rendered.container.querySelector('a[href="/settings/company"]')).toBeNull();
    expect(Array.from(rendered.container.querySelectorAll('button')).some(button => button.textContent === '再試行')).toBe(true);
    rendered.unmount();
  });
});
