// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { fictionalSnapshot, fictionalVersion } from '../../__fixtures__/fictionalReport';
import { fictionalDisclosedTexts, fictionalInternalTexts } from '../../__fixtures__/fictionalReportTexts';

const mocks = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mocks.search) }));
vi.mock('../../services/previewService', () => ({
  getSsbjWorkingPreview: vi.fn(),
  getSsbjVersionPreview: vi.fn(),
}));
vi.mock('../../services/versionExportService', () => ({ getSsbjApprovedVersion: vi.fn() }));
vi.mock('../../services/auditLogService', () => ({ recordSsbjExport: vi.fn(async () => {}) }));
// SSBJ のロールは、既定で入力担当として開く。
vi.mock('../../services/memberRoleService', () => ({ getMySsbjRole: vi.fn(async () => 'editor') }));

import { recordSsbjExport } from '../../services/auditLogService';
import { getSsbjVersionPreview, getSsbjWorkingPreview } from '../../services/previewService';
import { getMySsbjRole } from '../../services/memberRoleService';
import { getSsbjApprovedVersion } from '../../services/versionExportService';
import { toSsbjDisclosedSnapshot } from '../../utils/disclosedSnapshot';
import { SsbjPreviewPrintView } from '../SsbjPreviewPrintView.client';

let rendered: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const settle = async () => { for (let i = 0; i < 4; i += 1) await flush(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'print').mockImplementation(() => {});
  vi.mocked(getSsbjVersionPreview).mockResolvedValue({
    kind: 'version', versionId: fictionalVersion.id, versionNumber: 1,
    createdAt: fictionalVersion.createdAt, snapshot: fictionalVersion.snapshot,
  });
  vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 7, snapshot: fictionalSnapshot });
});
afterEach(() => {
  rendered?.unmount(); rendered = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('SsbjPreviewPrintView', () => {
  const printButton = () =>
    [...rendered!.container.querySelectorAll('button')].find(item => item.textContent?.includes('印刷 / PDFとして保存'))!;

  it('source に保存版の ID があれば、その保存版を読み込んで印刷ダイアログを開く。開いた直後の自動の印刷は記録しない', async () => {
    mocks.search = `source=${fictionalVersion.id}`;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await settle();
    expect(getSsbjVersionPreview).toHaveBeenCalledWith(fictionalVersion.reportId, fictionalVersion.id);
    expect(getSsbjWorkingPreview).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain('保存版 第1版');
    expect(rendered.container.textContent).not.toContain('内部メモ（開示しない）');
    await act(async () => { vi.advanceTimersByTime(400); });
    await settle();
    expect(window.print).toHaveBeenCalledTimes(1);
    // プレビューで選んだ時点で記録済みのため、自動の印刷では履歴を足さない。
    expect(recordSsbjExport).not.toHaveBeenCalled();
  });

  it('印刷用のタブでボタンを選び直すと、そのたびに版と一緒に 1 件記録してから印刷する', async () => {
    mocks.search = `source=${fictionalVersion.id}`;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await settle();
    await act(async () => { vi.advanceTimersByTime(400); });
    await settle();
    await act(async () => { printButton().click(); });
    await settle();
    expect(recordSsbjExport).toHaveBeenCalledTimes(1);
    expect(recordSsbjExport).toHaveBeenCalledWith(fictionalVersion.reportId, 'print', fictionalVersion.id);
    expect(window.print).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordSsbjExport).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(window.print).mock.invocationCallOrder[1]);
    await act(async () => { printButton().click(); });
    await settle();
    expect(recordSsbjExport).toHaveBeenCalledTimes(2);
  });

  it('作業中の内容は、版なし（作業中）として記録する', async () => {
    mocks.search = 'source=working';
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await settle();
    await act(async () => { printButton().click(); });
    await settle();
    expect(recordSsbjExport).toHaveBeenCalledWith(fictionalVersion.reportId, 'print', null);
  });

  it('記録に失敗しても印刷は続け、記録できなかったことを知らせる', async () => {
    vi.mocked(recordSsbjExport).mockRejectedValueOnce(new Error('network'));
    mocks.search = `source=${fictionalVersion.id}`;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await settle();
    await act(async () => { printButton().click(); });
    await settle();
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('印刷・PDF 保存はそのまま続けられます');
  });

  it('ブラウザのメニュー（Ctrl+P）からの印刷は記録しない', async () => {
    mocks.search = `source=${fictionalVersion.id}`;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await settle();
    await act(async () => { window.dispatchEvent(new Event('beforeprint')); });
    await settle();
    expect(recordSsbjExport).not.toHaveBeenCalled();
  });

  it.each([
    ['保存版', `source=${fictionalVersion.id}&internal=1`],
    ['作業中の内容', 'source=working&internal=1'],
  ])('URL に internal=1 が付いていても、%sの印刷に内部情報を含めず、開示する内容はすべて含める', async (_label, search) => {
    mocks.search = search;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await settle();
    const text = rendered.container.textContent ?? '';
    expect(fictionalDisclosedTexts.filter(value => !text.includes(value))).toEqual([]);
    expect(fictionalInternalTexts.filter(value => text.includes(value))).toEqual([]);
    expect(text).not.toContain('開示しない');
  });

  it('閲覧者は、source にかかわらず承認した保存版の開示する内容を API から読んで印刷する', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValueOnce('viewer');
    vi.mocked(getSsbjApprovedVersion).mockResolvedValue({
      id: fictionalVersion.id, reportId: fictionalVersion.reportId, versionNumber: 1, createdAt: fictionalVersion.createdAt,
      note: '承認時の保存版', sourceVersionId: null, createdByUserId: null, creatorName: '不明',
      snapshot: toSsbjDisclosedSnapshot(fictionalSnapshot).snapshot,
    });
    mocks.search = 'source=working&internal=1';
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await settle();
    expect(getSsbjApprovedVersion).toHaveBeenCalledWith(fictionalVersion.reportId);
    expect(getSsbjWorkingPreview).not.toHaveBeenCalled();
    expect(getSsbjVersionPreview).not.toHaveBeenCalled();
    const text = rendered.container.textContent ?? '';
    expect(text).toContain('保存版 第1版');
    expect(fictionalDisclosedTexts.filter(value => !text.includes(value))).toEqual([]);
    expect(fictionalInternalTexts.filter(value => text.includes(value))).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(400); });
    await settle();
    expect(window.print).toHaveBeenCalledTimes(1);
    await act(async () => { printButton().click(); });
    await settle();
    expect(recordSsbjExport).toHaveBeenCalledWith(fictionalVersion.reportId, 'print', fictionalVersion.id);
  });
});
