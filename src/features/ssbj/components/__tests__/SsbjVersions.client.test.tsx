// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import {
  FICTIONAL_DRAFT_REVIEW,
  fictionalVersion,
  fictionalVersionBeforeBasicInfoAdditions,
} from '../../__fixtures__/fictionalReport';

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
vi.mock('../../services/versionClient', () => ({ saveSsbjReportVersion: vi.fn() }));
vi.mock('../../services/auditLogService', () => ({ recordSsbjExport: vi.fn() }));
vi.mock('../../services/reportWorkflowClient', () => ({ restoreSsbjReportVersion: vi.fn() }));
vi.mock('../../services/versionXlsx', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/versionXlsx')>()),
  buildSsbjWorkbook: vi.fn(async () => ({})),
  downloadSsbjWorkbook: vi.fn(),
}));

import { useSsbjReport } from '../../hooks/useSsbjReport';
import {
  getSsbjCsvVersion,
  listSsbjCsvHistory,
  listSsbjVersions,
  recordSsbjCsvGeneration,
} from '../../services/versionExportService';
import { downloadSsbjVersionCsv } from '../../services/versionCsv';
import { saveSsbjReportVersion } from '../../services/versionClient';
import { recordSsbjExport } from '../../services/auditLogService';
import { restoreSsbjReportVersion } from '../../services/reportWorkflowClient';
import { buildSsbjWorkbook, downloadSsbjWorkbook } from '../../services/versionXlsx';
import type { SsbjReportReview } from '../../types';
import { SsbjVersions } from '../SsbjVersions.client';

let rendered: RenderResult | null = null;

const reloadReport = vi.fn();
const buttonWith = (root: ParentNode, text: string) => {
  const button = Array.from(root.querySelectorAll('button')).find(item => item.textContent?.includes(text));
  if (!button) throw new Error(`ボタン「${text}」がありません`);
  return button;
};

const renderScreen = async (review: SsbjReportReview = FICTIONAL_DRAFT_REVIEW) => {
  vi.mocked(useSsbjReport).mockReturnValue({
    report: { ...fictionalVersion.snapshot.report, draftRevision: 3, review },
    setReport: vi.fn(),
    reload: reloadReport,
    isLoading: false,
    errorMessage: '',
    isNotFound: false,
  });
  vi.mocked(listSsbjVersions).mockResolvedValue([{
    id: fictionalVersion.id,
    versionNumber: 1,
    createdAt: fictionalVersion.createdAt,
    note: null,
    sourceVersionId: null,
    createdByUserId: 'user-1',
    creatorName: '作成者',
  }]);
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
      reload: vi.fn(),
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
    expect(recordSsbjCsvGeneration).toHaveBeenCalledWith(fictionalVersion, 'csv');
    expect(downloadSsbjVersionCsv).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('CSV生成履歴を保存できません');
  });

  it('指定版のCSVを出力し、操作履歴と出力履歴に記録して表示する', async () => {
    vi.mocked(recordSsbjCsvGeneration).mockResolvedValue({
      id: 'log-1', versionId: fictionalVersion.id, versionNumber: 1, format: 'csv', createdAt: fictionalVersion.createdAt,
    });
    const { container } = await renderScreen();
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('CSVを出力'));
    if (!button) throw new Error('CSV出力ボタンがありません');
    await act(async () => { click(button); await Promise.resolve(); });
    expect(getSsbjCsvVersion).toHaveBeenCalledWith(fictionalVersion.reportId, fictionalVersion.id);
    expect(recordSsbjExport).toHaveBeenCalledWith(fictionalVersion.reportId, 'csv', fictionalVersion.id);
    expect(downloadSsbjVersionCsv).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('出力履歴');
    expect(container.textContent).toContain(`CSV · 版 1`);
  });

  it('指定版の Excel を CSV と同じ行から作って出力する', async () => {
    vi.mocked(recordSsbjCsvGeneration).mockResolvedValue({
      id: 'log-2', versionId: fictionalVersion.id, versionNumber: 1, format: 'xlsx', createdAt: fictionalVersion.createdAt,
    });
    const { container } = await renderScreen();
    await act(async () => { click(buttonWith(container, 'Excelを出力')); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(recordSsbjExport).toHaveBeenCalledWith(fictionalVersion.reportId, 'xlsx', fictionalVersion.id);
    expect(recordSsbjCsvGeneration).toHaveBeenCalledWith(fictionalVersion, 'xlsx');
    const [sheets] = vi.mocked(buildSsbjWorkbook).mock.calls[0];
    expect(sheets[0].name).toBe('SSBJレポート');
    expect(sheets[0].rows).toContainEqual(['版ID', fictionalVersion.id]);
    expect(downloadSsbjWorkbook).toHaveBeenCalledOnce();
    expect(downloadSsbjVersionCsv).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Excel · 版 1');
  });

  it('操作履歴に記録できなければ出力しない', async () => {
    vi.mocked(recordSsbjExport).mockRejectedValue(new Error('出力の記録を保存できなかったため、出力を中止しました'));
    const { container } = await renderScreen();
    await act(async () => { click(buttonWith(container, 'CSVを出力')); await Promise.resolve(); });
    expect(downloadSsbjVersionCsv).not.toHaveBeenCalled();
    expect(recordSsbjCsvGeneration).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('出力を中止しました');
  });

  it('確認後に作業中の内容をその版に戻し、戻す前の内容を保存した版と、読み直しを伝える', async () => {
    vi.mocked(restoreSsbjReportVersion).mockResolvedValue({
      restoredVersionNumber: 1, backupVersionId: 'backup-1', backupVersionNumber: 4, draftRevision: 9,
    });
    const { container } = await renderScreen();
    await act(async () => { click(buttonWith(container, 'この版の内容に戻す')); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('自動で残します');
    await act(async () => { click(buttonWith(document.querySelector('[role="dialog"]')!, 'この版の内容に戻す')); await Promise.resolve(); });
    expect(restoreSsbjReportVersion).toHaveBeenCalledWith(fictionalVersion.reportId, fictionalVersion.id, 3);
    expect(container.textContent).toContain('版 1 の内容に戻しました');
    expect(container.textContent).toContain('版 4 として保存しています');
    expect(reloadReport).toHaveBeenCalledOnce();
  });

  it('承認済みのレポートでは、復元の操作を出さない（新版の作成と出力はできる）', async () => {
    const { container } = await renderScreen({
      ...FICTIONAL_DRAFT_REVIEW, status: 'approved', approverUserId: 'user-1', approvedAt: '2025-06-05T00:00:00.000Z',
      approvedByUserId: 'user-1', approvedVersionId: fictionalVersion.id,
    });
    expect(container.textContent).not.toContain('この版の内容に戻す');
    expect(container.textContent).toContain('この版から新版を作成');
    expect(container.textContent).toContain('承認した版');
    expect(container.querySelector('[data-testid="ssbj-locked-notice"]')).not.toBeNull();
  });

  it('保存版の内容と内部メモを表示する', async () => {
    const { container } = await renderScreen();
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('内容を見る'));
    if (!button) throw new Error('内容表示ボタンがありません');
    await act(async () => { click(button); await Promise.resolve(); });
    expect(container.textContent).toContain(`版 ${fictionalVersion.versionNumber} の保存内容`);
    expect(container.textContent).toContain('内部メモ（開示しない）');
    expect(container.textContent).toContain('影響額の試算は経営企画部で実施中（架空）。');
  });

  it('任意項目を追加する前の保存版でも、キーの無い項目を「未入力」と表示する（undefined を出さない）', async () => {
    const { container } = await renderScreen();
    vi.mocked(getSsbjCsvVersion).mockResolvedValue(fictionalVersionBeforeBasicInfoAdditions);
    await act(async () => { click(buttonWith(container, '内容を見る')); await Promise.resolve(); });
    for (const label of ['親会社名', '親会社との関係', '親会社の持分比率', '測定アプローチ', '業種（SICS）']) {
      const term = Array.from(container.querySelectorAll('dt')).find(item => item.textContent === label);
      expect(term?.nextElementSibling?.textContent).toBe('未入力');
    }
    expect(container.textContent).not.toContain('undefined');
  });

  it('確認後に元版を指定して新版を作り、作業中データを変更しないと表示する', async () => {
    vi.mocked(saveSsbjReportVersion).mockResolvedValue({ id: fictionalVersion.id, versionNumber: 2 });
    const { container } = await renderScreen();
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('この版から新版を作成'));
    if (!button) throw new Error('新版作成ボタンがありません');
    await act(async () => { click(button); await Promise.resolve(); });
    const confirm = Array.from(document.querySelectorAll('button')).find(item => item.textContent === '新版を作成');
    if (!confirm) throw new Error('確認ボタンがありません');
    await act(async () => { click(confirm); await Promise.resolve(); });
    expect(saveSsbjReportVersion).toHaveBeenCalledWith(fictionalVersion.reportId, 3, fictionalVersion.id);
    expect(container.textContent).toContain('作業中データは変更されていません');
  });
});
