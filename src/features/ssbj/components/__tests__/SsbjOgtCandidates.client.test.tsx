// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { fictionalOgtCandidates, fictionalReportBasicInfo, fictionalSupplierReferences } from '../../__fixtures__/fictionalReport';

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()), getSsbjReport: vi.fn(),
}));
vi.mock('../../services/ogtCandidateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/ogtCandidateService')>()), getOgtCandidates: vi.fn(),
}));

import { getOgtCandidates } from '../../services/ogtCandidateService';
import { getSsbjReport } from '../../services/reportService';
import { SsbjOgtCandidates } from '../SsbjOgtCandidates.client';

const report = { ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', draftRevision: 1 };
let rendered: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(report);
  vi.mocked(getOgtCandidates).mockResolvedValue({
    candidates: fictionalOgtCandidates,
    suppliers: fictionalSupplierReferences,
  });
});
afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjOgtCandidates', () => {
  it('レポートの年度で取得し、基準不明・回答済み 0・未算定・参考値を表示する', async () => {
    rendered = render(<SsbjOgtCandidates reportId={report.id} />);
    await flush(); await flush();
    expect(getOgtCandidates).toHaveBeenCalledWith(expect.objectContaining({ fiscalYearId: report.fiscalYearId }));
    const content = rendered.container.textContent ?? '';
    expect(content).toContain('ロケーション基準・マーケット基準は不明');
    expect(content).toContain('0 t-CO2e');
    expect(content).toContain('未算定');
    expect(content).toContain('Scope 3 の候補値・合計には加算していません');
  });

  it('存在しない・他組織のレポートでは候補値を取得しない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    rendered = render(<SsbjOgtCandidates reportId="other-org" />);
    await flush(); await flush();
    expect(rendered.container.textContent).toContain('SSBJレポートが見つかりません');
    expect(getOgtCandidates).not.toHaveBeenCalled();
  });
});
