// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import type {
  ReportBaseData,
  ReportEmissionResult,
  ReportTargetSummary,
} from '../../services/reportService';
import { Reports } from '../Reports.client';

// レポート出力画面「出力内容のプレビュー」のコンポーネントテスト。
// Supabase を呼ぶ I/O だけをモックし、
//   - 合計の直下に「= 選択拠点 Scope 1・2 + 組織全体 Scope 3」の内訳が出ること
//   - 拠点を絞ると Scope 1・2 だけが減り、Scope 3 は組織全体のまま載ること
//   - 算定完了時は控えめな1行、失敗時は警告スタイルの説明になること
// を検証する。

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
// 見出しは next/link と年度メニューを内包し画面外の関心なので、タイトルだけの軽い実装に差し替える。
vi.mock('@/components/layout/PageHeading', () => ({
  PageHeading: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('../../services/reportService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()),
  getReportBaseData: vi.fn(),
  getReportEmissionResults: vi.fn(),
  createReportGenerationLog: vi.fn(),
}));

import { getReportBaseData, getReportEmissionResults } from '../../services/reportService';

const summary = (overrides: Partial<ReportTargetSummary> = {}): ReportTargetSummary => ({
  fiscalYearId: 'fy2025',
  fiscalYear: '2025',
  fiscalYearLabel: '2025年度',
  scope1Total: 30,
  scope2Total: 20,
  scope3Total: 100,
  totalEmissions: 150,
  scope3CategoryCount: 4,
  latestAggregateUpdatedAt: '2025-09-01T09:00:00Z',
  latestBatchStatus: 'completed',
  latestBatchCompletedAt: '2025-09-01T09:00:00Z',
  ...overrides,
});

const baseData = (overrides: Partial<ReportBaseData> = {}): ReportBaseData => ({
  fiscalYears: [
    { id: 'fy2025', year: '2025', label: '2025年度', startDate: '2025-04-01', endDate: '2026-03-31' },
  ],
  locations: [
    { id: 'loc-1', name: '東京本社', region: 'Kanto', regionLabel: '関東', type: 'headquarters', typeLabel: '本社' },
    { id: 'loc-2', name: '大阪工場', region: 'Kansai', regionLabel: '関西', type: 'factory', typeLabel: '工場' },
  ],
  summaries: [summary()],
  histories: [],
  ...overrides,
});

// 拠点 × Scope の集約行。東京 scope1=10（2件）/ scope2=5（1件）、大阪 scope1=20（3件）/ scope2=15（2件）。
const emissionResults: ReportEmissionResult[] = [
  { fiscalYearId: 'fy2025', locationId: 'loc-1', scope: 'scope1', emissions: 10, recordCount: 2 },
  { fiscalYearId: 'fy2025', locationId: 'loc-1', scope: 'scope2', emissions: 5, recordCount: 1 },
  { fiscalYearId: 'fy2025', locationId: 'loc-2', scope: 'scope1', emissions: 20, recordCount: 3 },
  { fiscalYearId: 'fy2025', locationId: 'loc-2', scope: 'scope2', emissions: 15, recordCount: 2 },
];

// 取得（getReportBaseData → 年度別の算定結果）は 2 段の非同期なので、effect が落ち着くまで数回まわす。
const flush = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
};

const previewText = (result: RenderResult): string =>
  result.container.querySelector('[data-testid="report-preview"]')?.textContent ?? '';

const freshnessBox = (result: RenderResult): HTMLElement | null =>
  result.container.querySelector<HTMLElement>('[data-testid="report-preview-freshness"]');

const mountReports = async (data: ReportBaseData): Promise<RenderResult> => {
  vi.mocked(getReportBaseData).mockResolvedValue(data);
  vi.mocked(getReportEmissionResults).mockResolvedValue(emissionResults);
  const result = render(<Reports />);
  await flush();
  return result;
};

describe('Reports - 出力内容のプレビュー', () => {
  let rendered: RenderResult | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    rendered?.unmount();
    rendered = null;
  });

  it('見出しとリード文で「レポートに載る内容のプレビュー」であることを名乗る', async () => {
    rendered = await mountReports(baseData());
    const text = previewText(rendered);
    expect(text).toContain('出力内容のプレビュー');
    expect(text).toContain('レポートに載る排出量です');
    // 旧ラベル（何のための数字か読めない）は残さない
    expect(text).not.toContain('対象データの確認');
    expect(text).not.toContain('対象レコード');
    expect(text).not.toContain('組織年度 Scope 3');
  });

  it('合計の直下に「選択拠点 Scope 1・2 + 組織全体 Scope 3」の内訳を出し、件数とカテゴリ数は分けて表示する', async () => {
    rendered = await mountReports(baseData());
    const text = previewText(rendered);
    // 全拠点選択: Scope1 30 + Scope2 20 + Scope3 100 = 150
    expect(text).toContain('レポートに載る合計（2025年度）');
    expect(text).toContain('150 t-CO2e');
    expect(text).toContain('= 選択拠点（2拠点） Scope 1・2 + 組織全体 Scope 3');
    expect(text).toContain('Scope 1 / 2（選択拠点（2拠点））');
    expect(text).toContain('30 t-CO2e / 20 t-CO2e');
    expect(text).toContain('算定済みレコード 8 件');
    expect(text).toContain('Scope 3（組織全体）');
    expect(text).toContain('100 t-CO2e');
    expect(text).toContain('4 カテゴリ');
  });

  it('拠点を絞ると Scope 1・2 と件数だけが減り、Scope 3 は組織全体のまま合計に載る', async () => {
    rendered = await mountReports(baseData());
    // 大阪工場のチェックを外す（行クリックでトグル）
    const rows = Array.from(rendered.container.querySelectorAll('tbody tr'));
    const osakaRow = rows.find(row => row.textContent?.includes('大阪工場'));
    expect(osakaRow).toBeTruthy();
    click(osakaRow as HTMLElement);

    const text = previewText(rendered);
    // 東京のみ: Scope1 10 + Scope2 5 + Scope3 100 = 115
    expect(text).toContain('115 t-CO2e');
    expect(text).toContain('= 選択拠点（1拠点） Scope 1・2 + 組織全体 Scope 3');
    expect(text).toContain('10 t-CO2e / 5 t-CO2e');
    expect(text).toContain('算定済みレコード 3 件');
    expect(text).toContain('100 t-CO2e');
    expect(text).toContain('拠点を絞っても Scope 3 は組織全体の値が載ります');
  });

  it('算定が完了していれば鮮度は控えめな1行で、警告スタイルにしない', async () => {
    rendered = await mountReports(baseData());
    const box = freshnessBox(rendered);
    expect(box?.textContent).toContain('算定完了');
    expect(box?.textContent).toContain('集計の最終更新');
    expect(box?.className).not.toContain('border-warning');
    expect(box?.getAttribute('role')).toBeNull();
  });

  it('算定が失敗していれば警告スタイルで、レポートに何が載るかを説明する', async () => {
    rendered = await mountReports(baseData({ summaries: [summary({ latestBatchStatus: 'failed' })] }));
    const box = freshnessBox(rendered);
    expect(box?.className).toContain('border-warning');
    expect(box?.getAttribute('role')).toBe('status');
    expect(box?.textContent).toContain('算定失敗');
    expect(box?.textContent).toContain('最後に集計できた内容');
  });

  it('算定実行中は警告スタイルで、完了前の出力に注意を促す', async () => {
    rendered = await mountReports(baseData({ summaries: [summary({ latestBatchStatus: 'pending' })] }));
    const box = freshnessBox(rendered);
    expect(box?.className).toContain('border-warning');
    expect(box?.textContent).toContain('算定実行中');
    expect(box?.textContent).toContain('反映されません');
  });
});
