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
vi.mock('../../services/versionExportService', () => ({ listSsbjVersions: vi.fn(), getSsbjApprovedVersion: vi.fn() }));


// SSBJ のロールは、既定で入力担当として操作する（編集の操作を出す）。
vi.mock('../../services/memberRoleService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberRoleService')>()),
  getMySsbjRole: vi.fn(async () => 'editor'),
}));
import { getSsbjVersionPreview, getSsbjWorkingPreview } from '../../services/previewService';
import { getSsbjReport } from '../../services/reportService';
import { getSsbjApprovedVersion, listSsbjVersions } from '../../services/versionExportService';
import { SsbjPreview } from '../SsbjPreview.client';
import { getMySsbjRole } from '../../services/memberRoleService';
import { fictionalDisclosedTexts, fictionalInternalTexts } from '../../__fixtures__/fictionalReportTexts';
import { toSsbjDisclosedSnapshot } from '../../utils/disclosedSnapshot';

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
afterEach(() => { rendered?.unmount(); rendered = null; vi.restoreAllMocks(); vi.clearAllMocks(); });

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

  it('存在しない・他組織のレポートでは内容を取得しない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    rendered = render(<SsbjPreview reportId="other" />);
    await settle();
    expect(rendered.container.textContent).toContain('SSBJレポートが見つかりません');
    expect(getSsbjWorkingPreview).not.toHaveBeenCalled();
    expect(listSsbjVersions).not.toHaveBeenCalled();
  });
});

describe('SsbjPreview（閲覧者）', () => {
  beforeEach(() => {
    vi.mocked(getMySsbjRole).mockResolvedValueOnce('viewer');
    vi.mocked(getSsbjReport).mockResolvedValue({
      ...report,
      review: { ...report.review, status: 'approved', approverUserId: 'u', approvedAt: '2025-06-05T00:00:00.000Z',
        approvedByUserId: 'u', approvedVersionId: fictionalVersion.id },
    });
    vi.mocked(getSsbjApprovedVersion).mockResolvedValue({
      id: fictionalVersion.id, reportId: report.id, versionNumber: 1, createdAt: fictionalVersion.createdAt,
      note: '承認時の保存版', sourceVersionId: null, createdByUserId: null, creatorName: '不明',
      snapshot: toSsbjDisclosedSnapshot(fictionalVersion.snapshot).snapshot,
    });
  });

  it('作業中の内容も保存版の行も読まず、承認した保存版の開示する内容を API から読んで出す', async () => {
    rendered = render(<SsbjPreview reportId={report.id} />);
    await settle();
    expect(getSsbjApprovedVersion).toHaveBeenCalledWith(report.id);
    expect(getSsbjWorkingPreview).not.toHaveBeenCalled();
    expect(getSsbjVersionPreview).not.toHaveBeenCalled();
    expect(listSsbjVersions).not.toHaveBeenCalled();
    expect(rendered.container.querySelector('[data-testid="ssbj-preview-source"]')?.textContent).toContain('保存版 第1版');
    const text = rendered.container.textContent ?? '';
    expect(fictionalDisclosedTexts.filter(value => !text.includes(value))).toEqual([]);
    const printLink = Array.from(rendered.container.querySelectorAll('a')).find(a => a.textContent?.includes('印刷'));
    expect(printLink?.getAttribute('href')).toBe(`/ssbj/${report.id}/preview/print?source=${fictionalVersion.id}`);
  });

  it('内部メモの表示の切替を出さず、内部メモ・内部記録を画面に出さない', async () => {
    rendered = render(<SsbjPreview reportId={report.id} />);
    await settle();
    expect(rendered.container.querySelector('#ssbj-preview-internal')).toBeNull();
    expect(rendered.container.textContent).not.toContain('内部メモも表示する');
    const text = rendered.container.textContent ?? '';
    expect(fictionalInternalTexts.filter(value => text.includes(value))).toEqual([]);
    expect(text).not.toContain('開示しない');
  });

  it('承認した保存版を読めなければ、そのメッセージを出す', async () => {
    vi.mocked(getSsbjApprovedVersion).mockRejectedValue(new Error('承認した保存版が見つかりません'));
    rendered = render(<SsbjPreview reportId={report.id} />);
    await settle();
    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('承認した保存版が見つかりません');
  });
});
