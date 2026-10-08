// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { FICTIONAL_DRAFT_REVIEW, fictionalReportBasicInfo, fictionalSnapshot, fictionalVersion } from '../../__fixtures__/fictionalReport';

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()), getSsbjReport: vi.fn(),
}));
vi.mock('../../services/previewService', () => ({
  getSsbjWorkingPreview: vi.fn(),
  getSsbjVersionPreview: vi.fn(),
}));
vi.mock('../../services/versionExportService', () => ({ listSsbjVersions: vi.fn() }));

import { getSsbjVersionPreview, getSsbjWorkingPreview } from '../../services/previewService';
import { getSsbjReport } from '../../services/reportService';
import { listSsbjVersions } from '../../services/versionExportService';
import { SsbjPreview } from '../SsbjPreview.client';

const report = { ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', draftRevision: 7, basicInfoRevision: 0, review: FICTIONAL_DRAFT_REVIEW };
let rendered: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const settle = async () => { for (let i = 0; i < 4; i += 1) await flush(); };

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(report);
  vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 7, snapshot: fictionalSnapshot });
  vi.mocked(getSsbjVersionPreview).mockResolvedValue({
    kind: 'version', versionId: fictionalVersion.id, versionNumber: 1,
    createdAt: fictionalVersion.createdAt, snapshot: fictionalVersion.snapshot,
  });
  vi.mocked(listSsbjVersions).mockResolvedValue([
    {
      id: fictionalVersion.id, versionNumber: 1, createdAt: fictionalVersion.createdAt, note: null,
      sourceVersionId: null, createdByUserId: null, creatorName: '不明',
    },
  ]);
});
afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjPreview', () => {
  it('最初は作業中の内容を出し、印刷ビューへのリンクに表示中の内容を渡す', async () => {
    rendered = render(<SsbjPreview reportId={report.id} />);
    await settle();
    expect(getSsbjWorkingPreview).toHaveBeenCalledWith(report.id);
    expect(getSsbjVersionPreview).not.toHaveBeenCalled();
    expect(rendered.container.querySelector('[data-testid="ssbj-preview-source"]')?.textContent).toContain('作業中の内容');
    const printLink = Array.from(rendered.container.querySelectorAll('a')).find(a => a.textContent?.includes('印刷・PDF'));
    expect(printLink?.getAttribute('href')).toBe(`/ssbj/${report.id}/preview/print?source=working&internal=0`);
    expect(printLink?.getAttribute('target')).toBe('_blank');
  });

  it('内部メモの表示を選ぶと、本文と印刷ビューの両方に反映する', async () => {
    rendered = render(<SsbjPreview reportId={report.id} />);
    await settle();
    expect(rendered.container.textContent).not.toContain('内部メモ（開示しない）');
    const checkbox = rendered.container.querySelector<HTMLButtonElement>('#ssbj-preview-internal');
    await act(async () => { click(checkbox!); });
    expect(rendered.container.textContent).toContain('内部メモ（開示しない）');
    const printLink = Array.from(rendered.container.querySelectorAll('a')).find(a => a.textContent?.includes('印刷・PDF'));
    expect(printLink?.getAttribute('href')).toContain('internal=1');
  });

  it('存在しない・他組織のレポートでは内容を取得しない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    rendered = render(<SsbjPreview reportId="other" />);
    await settle();
    expect(rendered.container.textContent).toContain('SSBJレポートが見つかりません');
    expect(getSsbjWorkingPreview).not.toHaveBeenCalled();
    expect(listSsbjVersions).not.toHaveBeenCalled();
  });
});
