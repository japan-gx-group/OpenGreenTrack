// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { fictionalVersion } from '../../__fixtures__/fictionalReport';

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
});
afterEach(() => {
  rendered?.unmount(); rendered = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('SsbjPreviewPrintView', () => {
  it('source に保存版の ID があれば、その保存版を読み込んで印刷ダイアログを開く', async () => {
    mocks.search = `source=${fictionalVersion.id}&internal=0`;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await flush(); await flush();
    expect(getSsbjVersionPreview).toHaveBeenCalledWith(fictionalVersion.reportId, fictionalVersion.id);
    expect(getSsbjWorkingPreview).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain('保存版 第1版');
    expect(rendered.container.textContent).not.toContain('内部メモ（開示しない）');
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('internal=1 なら内部メモも印刷に含める', async () => {
    mocks.search = `source=${fictionalVersion.id}&internal=1`;
    rendered = render(<SsbjPreviewPrintView reportId={fictionalVersion.reportId} />);
    await flush(); await flush();
    expect(rendered.container.textContent).toContain('内部メモ（開示しない）');
  });
});
