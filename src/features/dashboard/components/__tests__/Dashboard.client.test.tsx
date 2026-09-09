// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import type { DashboardData, LocationDashboardData } from '../../services/dashboardService';
import { Dashboard } from '../Dashboard.client';

// 月別グラフ下の「Scope 3 は年次で集計しているため〜」注記の表示条件を検証する。
// 注記は「Scope 3 の年次データはあるが月別内訳が無い」ことを説明するものなので、
// Scope 3 のデータ自体が無い組織（年間合計 0）に出すと、存在しない年次内訳を探しに行かせてしまう。

const fiscalYearMock = vi.hoisted(() => ({
  fiscalYearId: 'fy2025' as string | null,
  fiscalYear: '2025',
  fiscalYears: [
    { id: 'fy2025', label: '2025年度', year: '2025', startDate: '2025-04-01', endDate: '2026-03-31' },
  ] as FiscalYearOption[],
  isLoading: false,
  setFiscalYearId: () => {},
  refresh: async () => {},
}));

vi.mock('@/hooks/useFiscalYear', () => ({ useFiscalYear: () => fiscalYearMock }));
vi.mock('@/hooks/useAppRefresh', () => ({
  useAppRefresh: () => ({ refreshToken: 0, requestRefresh: () => {} }),
}));

vi.mock('../../services/dashboardService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/dashboardService')>()),
  getDashboardData: vi.fn(),
  getDashboardLocationOptions: vi.fn(),
  getLocationDashboardData: vi.fn(),
  getYearlyEmissions: vi.fn(),
}));

// 削減目標カードは独自にデータ取得するため、このテストの関心外として空実装に差し替える。
vi.mock('@/features/targets/components/ReductionTargetCard.client', () => ({
  ReductionTargetCard: () => null,
}));

import {
  getDashboardData,
  getDashboardLocationOptions,
  getLocationDashboardData,
} from '../../services/dashboardService';

const SCOPE3_NOTE = 'Scope 3 は年次で集計しているため、月別グラフには含まれていません';

const MONTH_LABELS = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];

/** 月別12点は buildDashboardMonthlyData と同様に常に生成される（データ有無に依らず length は 12）。 */
const monthlyPoints = (scope3PerMonth: number): DashboardData['monthlyData'] =>
  MONTH_LABELS.map(name => ({ name, scope1: 1, scope2: 1, scope3: scope3PerMonth, previousYearTotal: null }));

const dashboardData = (scope3Total: number, monthlyScope3: number): DashboardData => ({
  fiscalYear: {
    id: 'fy2025',
    label: '2025年度',
    startDate: '2025-04-01',
    endDate: '2026-03-31',
    organizationId: 'org1',
  },
  summary: [
    { title: '総排出量', value: 24 + scope3Total, diffPercent: null },
    { title: 'Scope 1', value: 12, diffPercent: null },
    { title: 'Scope 2', value: 12, diffPercent: null },
    { title: 'Scope 3', value: scope3Total, diffPercent: null },
  ],
  monthlyData: monthlyPoints(monthlyScope3),
  scope3PieData: [],
  topLocationDetails: [],
});

const flush = () => act(async () => {});

let mounted: RenderResult | null = null;

const renderDashboard = async (data: DashboardData) => {
  vi.mocked(getDashboardData).mockResolvedValue(data);
  mounted = render(<Dashboard />);
  // getDashboardData の解決と state 反映を待つ。
  await flush();
  return mounted.container;
};

describe('Dashboard Scope 3 注記', () => {
  beforeEach(() => {
    vi.mocked(getDashboardData).mockReset();
    vi.mocked(getDashboardLocationOptions).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('Scope 3 のデータが無い（年間合計 0）組織では注記を出さない', async () => {
    const container = await renderDashboard(dashboardData(0, 0));
    expect(container.textContent).not.toContain(SCOPE3_NOTE);
  });

  it('Scope 3 が年次集計のみ（年間合計 > 0 かつ月別 0）の組織では注記を出す', async () => {
    const container = await renderDashboard(dashboardData(100, 0));
    expect(container.textContent).toContain(SCOPE3_NOTE);
  });

  it('Scope 3 に月別内訳がある組織では注記を出さない', async () => {
    const container = await renderDashboard(dashboardData(120, 10));
    expect(container.textContent).not.toContain(SCOPE3_NOTE);
  });
});

// 「排出量上位拠点」は組織全体の Scope 1・2 ランキングで拠点絞り込みが効かないため、
// 絞り込み中は非表示にする（選択拠点の値の横に他拠点の数値が並ぶ誤読を防ぐ）。
const TOP_LOCATIONS_TITLE = '排出量上位拠点';

const topLocationDetail: DashboardData['topLocationDetails'][number] = {
  locationId: 'loc-1',
  name: '東京本社',
  region: 'kanto',
  type: 'office',
  scope1: 10,
  scope2: 5,
  total: 15,
  diffPercent: null,
};

const locationDashboardData: LocationDashboardData = {
  scope1Total: 10,
  scope2Total: 5,
  combinedTotal: 15,
  scope1DiffPercent: null,
  scope2DiffPercent: null,
  totalDiffPercent: null,
  monthlyData: MONTH_LABELS.map(name => ({ name, scope1: 1, scope2: 1, previousYearTotal: null })),
};

// KPI カードと上位拠点テーブルの前年比は「分子＝表示年度の期中累計・分母＝前年度の通年実績」の
// 比較のため、年度が終わるまでは実態より大きな「削減」に見える。評価色は年度終了後に限る。
// ここでは画面が年度行の期間から終了判定を渡せていること（配線）を確認する。
describe('Dashboard 前年比の評価色', () => {
  const summaryWithDiff = (): DashboardData['summary'] => [
    { title: '総排出量', value: 450, diffPercent: -55 },
    { title: 'Scope 1', value: 150, diffPercent: -55 },
    { title: 'Scope 2', value: 150, diffPercent: -55 },
    { title: 'Scope 3', value: 150, diffPercent: -55 },
  ];

  const renderWithDiff = () =>
    renderDashboard({
      ...dashboardData(150, 10),
      summary: summaryWithDiff(),
      topLocationDetails: [{ ...topLocationDetail, diffPercent: -55 }],
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.mocked(getDashboardData).mockReset();
    vi.mocked(getDashboardLocationOptions).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    mounted?.unmount();
    mounted = null;
  });

  it('期中は KPI カード・上位拠点テーブルとも「（期中）」付きの中立色にする', async () => {
    // FY2025（2025-04-01 〜 2026-03-31）の期中。
    vi.setSystemTime(new Date('2025-09-08T12:00:00+09:00'));
    const container = await renderWithDiff();

    const pills = Array.from(container.querySelectorAll<HTMLElement>('.gt-pill')).filter(pill =>
      pill.textContent?.includes('55.0%'),
    );
    // KPI カード4枚 + 上位拠点テーブル1行
    expect(pills).toHaveLength(5);
    pills.forEach(pill => {
      expect(pill.className).toContain('gt-pill-neutral');
      expect(pill.className).not.toContain('gt-pill-good');
      expect(pill.textContent).toBe('↓55.0%（期中）');
    });
  });

  it('年度終了後は評価色を付け、「（期中）」を出さない', async () => {
    vi.setSystemTime(new Date('2026-09-08T12:00:00+09:00'));
    const container = await renderWithDiff();

    const pills = Array.from(container.querySelectorAll<HTMLElement>('.gt-pill')).filter(pill =>
      pill.textContent?.includes('55.0%'),
    );
    expect(pills).toHaveLength(5);
    pills.forEach(pill => {
      expect(pill.className).toContain('gt-pill-good');
      expect(pill.textContent).toBe('↓55.0%');
    });
  });
});

describe('Dashboard 排出量上位拠点カードの表示条件', () => {
  beforeEach(() => {
    vi.mocked(getDashboardData).mockReset();
    vi.mocked(getDashboardLocationOptions).mockReset().mockResolvedValue([]);
    vi.mocked(getLocationDashboardData).mockReset().mockResolvedValue(locationDashboardData);
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('全拠点表示では上位拠点カードを表示する', async () => {
    const container = await renderDashboard({
      ...dashboardData(0, 0),
      topLocationDetails: [topLocationDetail],
    });
    expect(container.textContent).toContain(TOP_LOCATIONS_TITLE);
  });

  it('拠点で絞り込むと上位拠点カードを非表示にする', async () => {
    const container = await renderDashboard({
      ...dashboardData(0, 0),
      topLocationDetails: [topLocationDetail],
    });

    // 上位拠点テーブルの行から絞り込む（絞り込みチップと同じ handleSelectLocation を通る）。
    const rowButton = container.querySelector<HTMLButtonElement>('tbody button[aria-pressed]');
    expect(rowButton?.textContent).toContain('東京本社');
    click(rowButton!);
    await flush();

    expect(container.textContent).not.toContain(TOP_LOCATIONS_TITLE);
  });
});
