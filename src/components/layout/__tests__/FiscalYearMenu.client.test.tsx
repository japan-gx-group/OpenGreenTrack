// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import { FiscalYearMenu } from '../FiscalYearMenu.client';

// 年度セレクタの「・現在」表示のコンポーネントテスト。
// 「現在」は DB のフラグではなく「今日が startDate〜endDate に含まれるか」で導出するので、
// 会計年度コンテキストだけをモックし、Date を固定して表示を検証する。

const fiscalYearMock = vi.hoisted(() => ({
  fiscalYearId: 'fy2027' as string | null,
  fiscalYear: '2027',
  fiscalYears: [] as FiscalYearOption[],
  isLoading: false,
  setFiscalYearId: () => {},
  refresh: async () => {},
}));

vi.mock('@/hooks/useFiscalYear', () => ({ useFiscalYear: () => fiscalYearMock }));

const year = (startYear: number): FiscalYearOption => ({
  id: `fy${startYear}`,
  label: `${startYear}年度`,
  year: String(startYear),
  startDate: `${startYear}-04-01`,
  endDate: `${startYear + 1}-03-31`,
});

let mounted: RenderResult | null = null;

const optionLabels = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('[role="option"]')).map(
    option => option.querySelector('span:nth-of-type(2)')?.textContent ?? '',
  );

describe('FiscalYearMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 先に 2027 年度を登録済みの組織を想定する（既定の選択年度は最新の 2027 年度、今日は 2026 年度内）。
    vi.setSystemTime(new Date('2026-09-07T12:00:00+09:00'));
    fiscalYearMock.fiscalYears = [year(2027), year(2026), year(2025)];
    fiscalYearMock.fiscalYearId = 'fy2027';
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.useRealTimers();
  });

  it('今日が期間内の年度にだけ「・現在」を表示する（選択中の最新年度ではない）', () => {
    mounted = render(<FiscalYearMenu />);
    click(mounted.container.querySelector('[data-testid="fiscal-year-menu"]')!);

    expect(optionLabels(mounted.container)).toEqual(['2027年度', '2026年度・現在', '2025年度']);
  });

  // 年度の切り替わり日は日本時間で判定する（サーバや CI が UTC でも 4/1 0:00 JST から新年度）。
  it('日本時間で新年度に入った瞬間から「・現在」が次の年度へ移る', () => {
    vi.setSystemTime(new Date('2027-03-31T15:00:00Z')); // 2027-04-01T00:00:00+09:00
    mounted = render(<FiscalYearMenu />);
    click(mounted.container.querySelector('[data-testid="fiscal-year-menu"]')!);

    expect(optionLabels(mounted.container)).toEqual(['2027年度・現在', '2026年度', '2025年度']);
  });
});
