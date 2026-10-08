// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { FICTIONAL_DRAFT_REVIEW, fictionalReportBasicInfo, fictionalSnapshot, fictionalVersion } from '../../__fixtures__/fictionalReport';
import { fictionalInternalTexts } from '../../__fixtures__/fictionalReportTexts';

const mocks = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', async importOriginal => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

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
import { SsbjPreviewPrintView } from '../SsbjPreviewPrintView.client';

const report = { ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', draftRevision: 7, review: FICTIONAL_DRAFT_REVIEW };
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
afterEach(() => { rendered?.unmount(); rendered = null; mocks.search = ''; vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('SsbjPreview', () => {
  it('最初は作業中の内容を出し、印刷ビューへのリンクに表示中の内容を渡す', async () => {
    rendered = render(<SsbjPreview reportId={report.id} />);
    await settle();
    expect(getSsbjWorkingPreview).toHaveBeenCalledWith(report.id);
    expect(getSsbjVersionPreview).not.toHaveBeenCalled();
    expect(rendered.container.querySelector('[data-testid="ssbj-preview-source"]')?.textContent).toContain('作業中の内容');
    const printLink = Array.from(rendered.container.querySelectorAll('a')).find(a => a.textContent?.includes('印刷・PDF'));
    expect(printLink?.getAttribute('href')).toBe(`/ssbj/${report.id}/preview/print?source=working`);
    expect(printLink?.getAttribute('target')).toBe('_blank');
  });

  it('内部メモの表示を選ぶと画面の本文には出すが、印刷ビューへのリンクには渡さない', async () => {
    rendered = render(<SsbjPreview reportId={report.id} />);
    await settle();
    expect(rendered.container.textContent).not.toContain('内部メモ（開示しない）');
    const checkbox = rendered.container.querySelector<HTMLButtonElement>('#ssbj-preview-internal');
    await act(async () => { click(checkbox!); });
    expect(rendered.container.textContent).toContain('内部メモ（開示しない）');
    const printLink = Array.from(rendered.container.querySelectorAll('a')).find(a => a.textContent?.includes('印刷・PDF'));
    expect(printLink?.getAttribute('href')).toBe(`/ssbj/${report.id}/preview/print?source=working`);
  });

  it('内部メモを表示したまま印刷リンクをたどっても、印刷ビューに内部メモ・内部記録は出ない', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    rendered = render(<SsbjPreview reportId={report.id} />);
    await settle();
    const checkbox = rendered.container.querySelector<HTMLButtonElement>('#ssbj-preview-internal');
    await act(async () => { click(checkbox!); });
    expect(fictionalInternalTexts.filter(value => !rendered!.container.textContent!.includes(value))).toEqual([]);
    const printLink = Array.from(rendered.container.querySelectorAll('a')).find(a => a.textContent?.includes('印刷・PDF'));
    const href = new URL(printLink!.getAttribute('href')!, 'http://localhost');
    expect(href.pathname).toBe(`/ssbj/${report.id}/preview/print`);
    rendered.unmount();

    mocks.search = href.search;
    rendered = render(<SsbjPreviewPrintView reportId={report.id} />);
    await settle();
    const text = rendered.container.textContent ?? '';
    expect(text).toContain('作業中の内容');
    expect(fictionalInternalTexts.filter(value => text.includes(value))).toEqual([]);
    expect(text).not.toContain('開示しない');
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
