// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { FiscalYearList } from '../FiscalYearList.client';

// 算定年度の一覧は全員に見せ、追加・削除は管理者だけに出す（Server Action でも管理者に限られる）ことを確かめる。

const mocks = vi.hoisted(() => ({
  currentProfile: null as null | { id: string; role: string },
}));

vi.mock('@/features/settings/services/fiscalYears', () => ({
  addFiscalYear: vi.fn(),
  deleteFiscalYear: vi.fn(),
  listFiscalYearsWithUsage: vi.fn(async () => ({
    ok: true,
    data: {
      fiscalYearStartMonth: 4,
      years: [
        { id: 'fy-2026', label: '2026年度', startDate: '2026-04-01', endDate: '2027-03-31', hasData: false },
      ],
    },
  })),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ profile: mocks.currentProfile }),
}));

vi.mock('@/hooks/useFiscalYear', () => ({
  useFiscalYear: () => ({ refresh: vi.fn() }),
}));

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

describe('FiscalYearList の出し分け', () => {
  let view: RenderResult | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('メンバーには一覧だけを見せ、追加・削除の操作を出さない', async () => {
    mocks.currentProfile = { id: 'member-1', role: 'logger' };
    view = render(<FiscalYearList showToast={vi.fn()} />);
    await flush();
    expect(view.container.textContent).toContain('2026年度');
    expect(view.container.querySelector('#fiscal-year-input')).toBeNull();
    expect(view.container.querySelector('button[title="この年度を削除"]')).toBeNull();
    expect(view.container.textContent).toContain('年度の追加・削除は管理者のみできます。');
  });

  it('管理者には追加と削除の操作を出す', async () => {
    mocks.currentProfile = { id: 'admin-1', role: 'admin' };
    view = render(<FiscalYearList showToast={vi.fn()} />);
    await flush();
    expect(view.container.querySelector('#fiscal-year-input')).not.toBeNull();
    expect(view.container.querySelector('button[title="この年度を削除"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('年度の追加・削除は管理者のみできます。');
  });
});
