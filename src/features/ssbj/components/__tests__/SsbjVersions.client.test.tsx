// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { fictionalVersion } from '../../__fixtures__/fictionalReport';

vi.mock('../../hooks/useSsbjReport', () => ({ useSsbjReport: vi.fn() }));
vi.mock('../../services/versionExportService', () => ({
  listSsbjVersions: vi.fn(),
  listSsbjCsvHistory: vi.fn(),
  getSsbjCsvVersion: vi.fn(),
  recordSsbjCsvGeneration: vi.fn(),
}));
vi.mock('../../services/versionCsv', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/versionCsv')>()),
  downloadSsbjVersionCsv: vi.fn(),
}));

import { useSsbjReport } from '../../hooks/useSsbjReport';
import {
  getSsbjCsvVersion,
  listSsbjCsvHistory,
  listSsbjVersions,
  recordSsbjCsvGeneration,
} from '../../services/versionExportService';
import { downloadSsbjVersionCsv } from '../../services/versionCsv';
import { SsbjVersions } from '../SsbjVersions.client';

let rendered: RenderResult | null = null;

const renderScreen = async () => {
  vi.mocked(useSsbjReport).mockReturnValue({
    report: { ...fictionalVersion.snapshot.report, draftRevision: 3 },
    setReport: vi.fn(),
    isLoading: false,
    errorMessage: '',
    isNotFound: false,
  });
  vi.mocked(listSsbjVersions).mockResolvedValue([{ id: fictionalVersion.id, versionNumber: 1, createdAt: fictionalVersion.createdAt, note: null }]);
  vi.mocked(listSsbjCsvHistory).mockResolvedValue([]);
  vi.mocked(getSsbjCsvVersion).mockResolvedValue(fictionalVersion);
  rendered = render(<SsbjVersions reportId={fictionalVersion.reportId} />);
  await act(async () => { await Promise.resolve(); });
  return rendered;
};

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.clearAllMocks();
});

describe('SsbjVersions', () => {
  it('見えないレポートでは固定版を取得せず出力もしない', () => {
    vi.mocked(useSsbjReport).mockReturnValue({
      report: null,
      setReport: vi.fn(),
      isLoading: false,
      errorMessage: '',
      isNotFound: true,
    });
    rendered = render(<SsbjVersions reportId="5b1f0000-0000-4000-8000-0000000000ff" />);
    expect(rendered.container.textContent).toContain('SSBJレポートが見つかりません');
    expect(listSsbjVersions).not.toHaveBeenCalled();
    expect(getSsbjCsvVersion).not.toHaveBeenCalled();
  });

  it('履歴記録に失敗するとCSVをダウンロードしない', async () => {
    vi.mocked(recordSsbjCsvGeneration).mockRejectedValue(new Error('CSV生成履歴を保存できません'));
    const { container } = await renderScreen();
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('CSVを出力'));
    if (!button) throw new Error('CSV出力ボタンがありません');
    await act(async () => { click(button); await Promise.resolve(); });
    expect(recordSsbjCsvGeneration).toHaveBeenCalledWith(fictionalVersion);
    expect(downloadSsbjVersionCsv).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('CSV生成履歴を保存できません');
  });

  it('指定版のCSVを出力し、生成履歴を表示する', async () => {
    vi.mocked(recordSsbjCsvGeneration).mockResolvedValue({
      id: 'log-1', versionId: fictionalVersion.id, versionNumber: 1, createdAt: fictionalVersion.createdAt,
    });
    const { container } = await renderScreen();
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('CSVを出力'));
    if (!button) throw new Error('CSV出力ボタンがありません');
    await act(async () => { click(button); await Promise.resolve(); });
    expect(getSsbjCsvVersion).toHaveBeenCalledWith(fictionalVersion.reportId, fictionalVersion.id);
    expect(downloadSsbjVersionCsv).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('CSV生成履歴');
    expect(container.textContent).toContain(fictionalVersion.id);
  });
});
