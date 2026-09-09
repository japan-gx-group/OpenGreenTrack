// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import { useFiscalYearFromQuery } from '../useFiscalYearFromQuery';

// 選択年度はタブ内の state で永続化されないため、導線が URL で運んだ年度（?fy=）を
// Scope分析画面が受け取って選択年度へ適用する。その適用条件を検証する。

const FY2024: FiscalYearOption = {
  id: 'fy2024', label: '2024年度', year: '2024', startDate: '2024-04-01', endDate: '2025-03-31',
};
const FY2025: FiscalYearOption = {
  id: 'fy2025', label: '2025年度', year: '2025', startDate: '2025-04-01', endDate: '2026-03-31',
};

const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParamsMock.value }));

const fiscalYearMock = vi.hoisted(() => ({
  fiscalYearId: 'fy2025' as string | null,
  fiscalYear: '2025',
  fiscalYears: [] as FiscalYearOption[],
  isLoading: false,
  setFiscalYearId: vi.fn(),
  refresh: async () => {},
}));
vi.mock('@/hooks/useFiscalYear', () => ({ useFiscalYear: () => fiscalYearMock }));

const Probe = () => {
  useFiscalYearFromQuery();
  return null;
};

let mounted: RenderResult | null = null;

const renderProbe = () => {
  mounted = render(<Probe />);
  return mounted;
};

describe('useFiscalYearFromQuery', () => {
  beforeEach(() => {
    searchParamsMock.value = new URLSearchParams();
    fiscalYearMock.fiscalYears = [FY2025, FY2024];
    fiscalYearMock.setFiscalYearId.mockReset();
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('?fy= が登録済みの年度に一致すれば選択年度へ適用する', () => {
    searchParamsMock.value = new URLSearchParams('fy=fy2024');
    renderProbe();
    expect(fiscalYearMock.setFiscalYearId).toHaveBeenCalledTimes(1);
    expect(fiscalYearMock.setFiscalYearId).toHaveBeenCalledWith('fy2024');
  });

  it('?fy= が無ければ何もしない', () => {
    renderProbe();
    expect(fiscalYearMock.setFiscalYearId).not.toHaveBeenCalled();
  });

  // 削除済み・改変された ID で選択年度を壊さない（既定の最新年度のまま表示する）。
  it('登録されていない年度IDは無視する', () => {
    searchParamsMock.value = new URLSearchParams('fy=unknown');
    renderProbe();
    expect(fiscalYearMock.setFiscalYearId).not.toHaveBeenCalled();
  });

  // 新しいタブでは年度一覧の取得が画面の初回描画より後になる。
  it('年度一覧のロード完了を待ってから適用する', () => {
    searchParamsMock.value = new URLSearchParams('fy=fy2024');
    fiscalYearMock.fiscalYears = [];
    const { rerender } = renderProbe();
    expect(fiscalYearMock.setFiscalYearId).not.toHaveBeenCalled();

    fiscalYearMock.fiscalYears = [FY2025, FY2024];
    rerender(<Probe />);
    expect(fiscalYearMock.setFiscalYearId).toHaveBeenCalledWith('fy2024');
  });

  // 適用後に利用者がヘッダーで別年度を選んだあと、認証イベントで年度一覧が新しい配列として
  // 取り直されても、URL の年度へ引き戻さない。
  it('同じ指定は一度だけ適用し、年度一覧の再取得で再適用しない', () => {
    searchParamsMock.value = new URLSearchParams('fy=fy2024');
    const { rerender } = renderProbe();
    expect(fiscalYearMock.setFiscalYearId).toHaveBeenCalledTimes(1);

    fiscalYearMock.fiscalYears = [{ ...FY2025 }, { ...FY2024 }];
    rerender(<Probe />);
    expect(fiscalYearMock.setFiscalYearId).toHaveBeenCalledTimes(1);
  });
});
