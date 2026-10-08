// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { FICTIONAL_DRAFT_REVIEW, fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';
import type { SsbjAuditLog } from '../../types';

// SSBJ 操作履歴の画面: 誰が・何を・どの対象に、を名前と言葉で出すこと、操作の種類での絞り込み、
// 出力は記録してから行い、記録できなければ出力しないことを検証する。Supabase を呼ぶ I/O だけをモックする。

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()), getSsbjReport: vi.fn(),
}));
vi.mock('../../services/auditLogService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/auditLogService')>()),
  listSsbjAuditLogs: vi.fn(),
  recordSsbjExport: vi.fn(),
}));
vi.mock('../../services/memberService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberService')>()),
  listSsbjMembers: vi.fn(async () => [{ id: 'user-1', name: '環境 太郎', role: 'admin' }]),
  getCurrentSsbjUserId: vi.fn(async () => 'user-1'),
}));
vi.mock('@/lib/files/csv', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/files/csv')>()), downloadCsv: vi.fn(),
}));
vi.mock('../../services/versionXlsx', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/versionXlsx')>()),
  buildSsbjWorkbook: vi.fn(async () => ({})),
  downloadSsbjWorkbook: vi.fn(),
}));

import { downloadCsv } from '@/lib/files/csv';
import { listSsbjAuditLogs, recordSsbjExport } from '../../services/auditLogService';
import { getSsbjReport } from '../../services/reportService';
import { buildSsbjWorkbook, downloadSsbjWorkbook } from '../../services/versionXlsx';
import { SsbjAuditLogs } from '../SsbjAuditLogs.client';

const report = { ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度', periodStart: '2024-04-01',
  periodEnd: '2025-03-31', draftRevision: 1, basicInfoRevision: 0, review: FICTIONAL_DRAFT_REVIEW };
const logs: SsbjAuditLog[] = [
  { id: 3, reportId: report.id, actorUserId: 'user-1', action: 'status_change', targetType: 'report', targetId: report.id,
    changedColumns: null, details: { operation: 'approve', from: 'in_review', to: 'approved', versionNumber: 2 },
    createdAt: '2025-06-05T03:00:00.000Z' },
  { id: 2, reportId: report.id, actorUserId: 'user-1', action: 'update', targetType: 'narrative',
    targetId: 'governance.oversight_body', changedColumns: ['disclosureText'], details: {}, createdAt: '2025-06-05T02:00:00.000Z' },
  { id: 1, reportId: report.id, actorUserId: 'user-gone', action: 'create', targetType: 'report', targetId: report.id,
    changedColumns: null, details: { label: report.title }, createdAt: '2025-06-05T01:00:00.000Z' },
];

let rendered: RenderResult | null = null;
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ssbj-audit-row"]'));
const buttonWith = (text: string) => {
  const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes(text));
  if (!button) throw new Error(`ボタン「${text}」がありません`);
  return button;
};

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(report);
  vi.mocked(listSsbjAuditLogs).mockResolvedValue(logs);
});
afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjAuditLogs', () => {
  it('新しい順に、操作した人の名前・操作・対象・内容を出す（いない利用者は「不明な利用者」）', async () => {
    rendered = render(<SsbjAuditLogs reportId={report.id} />);
    await settle();
    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toContain('環境 太郎');
    expect(rows()[0].textContent).toContain('承認（レビュー中 → 承認済み） / 承認した版: 版 2');
    expect(rows()[1].textContent).toContain('四本柱の文章: 監督する機関・責任者');
    expect(rows()[1].textContent).toContain('開示する内容');
    expect(rows()[2].textContent).toContain('不明な利用者');
  });

  it('操作の種類で絞り込める', async () => {
    rendered = render(<SsbjAuditLogs reportId={report.id} />);
    await settle();
    const select = document.querySelector<HTMLSelectElement>('#ssbj-audit-action')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    act(() => { setter?.call(select, 'update'); select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(rows()).toHaveLength(1);
    expect(document.querySelector('[data-testid="ssbj-audit-count"]')?.textContent).toBe('1 件');
  });

  it('CSV・Excel は記録してから出力し、出力後に履歴を読み直す', async () => {
    rendered = render(<SsbjAuditLogs reportId={report.id} />);
    await settle();
    await act(async () => { click(buttonWith('CSVで出力')); });
    await settle();
    expect(recordSsbjExport).toHaveBeenCalledWith(report.id, 'audit_csv');
    const [fileName, csvRows] = vi.mocked(downloadCsv).mock.calls[0];
    expect(fileName).toMatch(/^SSBJ_操作履歴_\d{8}-\d{4}\.csv$/);
    expect(csvRows).toContainEqual(['件数', '3']);
    expect(listSsbjAuditLogs).toHaveBeenCalledTimes(2);

    await act(async () => { click(buttonWith('Excelで出力')); });
    await settle();
    expect(recordSsbjExport).toHaveBeenCalledWith(report.id, 'audit_xlsx');
    expect(vi.mocked(buildSsbjWorkbook).mock.calls[0][0][0].name).toBe('操作履歴');
    expect(downloadSsbjWorkbook).toHaveBeenCalledOnce();
  });

  it('記録できなければ出力しない', async () => {
    vi.mocked(recordSsbjExport).mockRejectedValue(new Error('出力の記録を保存できなかったため、出力を中止しました'));
    rendered = render(<SsbjAuditLogs reportId={report.id} />);
    await settle();
    await act(async () => { click(buttonWith('CSVで出力')); });
    await settle();
    expect(downloadCsv).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('出力を中止しました');
  });

  it('存在しない・他組織のレポートでは履歴を取得しない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    rendered = render(<SsbjAuditLogs reportId="other" />);
    await settle();
    expect(rendered.container.textContent).toContain('SSBJレポートが見つかりません');
    expect(listSsbjAuditLogs).not.toHaveBeenCalled();
  });
});
