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

import { getSsbjVersionPreview, getSsbjWorkingPreview } from '../../services/previewService';
import { SsbjPreviewPrintView } from '../SsbjPreviewPrintView.client';

let rendered: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

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
  it('source に保存版の ID があれば、その保存版を読み込んで印刷ダイアログを開く', async () => {
    mocks.search = `source=${fictionalVersion.id}`;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await flush(); await flush();
    expect(getSsbjVersionPreview).toHaveBeenCalledWith(fictionalVersion.reportId, fictionalVersion.id);
    expect(getSsbjWorkingPreview).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain('保存版 第1版');
    expect(rendered.container.textContent).not.toContain('内部メモ（開示しない）');
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['保存版', `source=${fictionalVersion.id}`],
    ['作業中の内容', 'source=working'],
  ])('%sの印刷に、内部メモ・内部記録を含めず、開示する内容はすべて含める', async (_label, search) => {
    mocks.search = search;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await flush(); await flush();
    const text = rendered.container.textContent ?? '';
    expect(fictionalDisclosedTexts.filter(value => !text.includes(value))).toEqual([]);
    expect(fictionalInternalTexts.filter(value => text.includes(value))).toEqual([]);
    expect(text).not.toContain('開示しない');
  });

  it.each(['1', 'true'])('URL に internal=%s が付いていても、内部メモ・内部記録を印刷に含めない', async internal => {
    for (const source of [fictionalVersion.id, 'working']) {
      mocks.search = `source=${source}&internal=${internal}`;
      rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
      await flush(); await flush();
      const text = rendered.container.textContent ?? '';
      expect(text).toContain('取締役会の開催記録に基づく。');
      expect(fictionalInternalTexts.filter(value => text.includes(value))).toEqual([]);
      expect(text).not.toContain('内部メモ（開示しない）');
      expect(text).not.toContain('内部記録・開示しない');
      expect(text).not.toContain('内部の検討理由（開示しない）');
      rendered.unmount(); rendered = null;
    }
  });
});
