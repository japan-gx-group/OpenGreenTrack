// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import {
  fictionalGhgAdoption,
  fictionalOgtCandidates,
  fictionalReportBasicInfo,
  fictionalSupplierReferences,
} from '../../__fixtures__/fictionalReport';

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()), getSsbjReport: vi.fn(),
}));
vi.mock('../../services/ogtCandidateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/ogtCandidateService')>()), getOgtCandidates: vi.fn(),
}));
vi.mock('../../services/ogtAdoptionService', () => ({
  getOgtAdoption: vi.fn(),
  adoptOgtCandidates: vi.fn(),
  clearOgtAdoption: vi.fn(),
}));

import { getOgtCandidates } from '../../services/ogtCandidateService';
import { adoptOgtCandidates, clearOgtAdoption, getOgtAdoption } from '../../services/ogtAdoptionService';
import { getSsbjReport } from '../../services/reportService';
import { ogtCandidateFingerprint } from '../../utils/ogtAdoption';
import { SsbjOgtCandidates } from '../SsbjOgtCandidates.client';

const report = { ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', draftRevision: 1 };
let rendered: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const settle = async () => { for (let i = 0; i < 4; i += 1) await flush(); };

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement => {
  const button = Array.from(root.querySelectorAll('button')).find(element => element.textContent?.includes(text));
  if (!button) throw new Error(`ボタン「${text}」が見つかりません`);
  return button;
};

/** 確認ダイアログ（ポータルで document.body に出る）の中のボタン。文字列は完全一致で探す。 */
const dialogButton = (text: string): HTMLButtonElement => {
  const dialog = document.body.querySelector('[role="dialog"]');
  const button = Array.from(dialog?.querySelectorAll('button') ?? []).find(element => element.textContent?.trim() === text);
  if (!button) throw new Error(`ダイアログのボタン「${text}」が見つかりません`);
  return button;
};

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(report);
  vi.mocked(getOgtCandidates).mockResolvedValue({
    candidates: fictionalOgtCandidates,
    suppliers: fictionalSupplierReferences,
  });
  vi.mocked(getOgtAdoption).mockResolvedValue(null);
  vi.mocked(adoptOgtCandidates).mockResolvedValue({ adoptedAt: '2025-06-03T02:00:00+00:00' });
  vi.mocked(clearOgtAdoption).mockResolvedValue();
});
afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjOgtCandidates', () => {
  it('レポートの年度で取得し、基準不明・回答済み 0・未算定・参考値を表示する', async () => {
    rendered = render(<SsbjOgtCandidates reportId={report.id} />);
    await settle();
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
    await settle();
    expect(rendered.container.textContent).toContain('SSBJレポートが見つかりません');
    expect(getOgtCandidates).not.toHaveBeenCalled();
  });
});

describe('SsbjOgtCandidates（採用）', () => {
  it('確認のうえ、表示中の候補値の指紋だけを送って採用し、採用状況を読み直す', async () => {
    rendered = render(<SsbjOgtCandidates reportId={report.id} />);
    await settle();
    expect(rendered.container.textContent).toContain('まだ採用していません');

    await act(async () => { click(buttonByText(rendered!.container, '表示中の候補値を採用する')); });
    // 確認ダイアログを経ずに採用しない。
    expect(adoptOgtCandidates).not.toHaveBeenCalled();
    vi.mocked(getOgtAdoption).mockResolvedValue(fictionalGhgAdoption);
    await act(async () => { click(dialogButton('採用する')); await Promise.resolve(); });
    await settle();

    expect(adoptOgtCandidates).toHaveBeenCalledWith(
      report.id,
      ogtCandidateFingerprint(fictionalOgtCandidates, fictionalSupplierReferences),
    );
    expect(getOgtAdoption).toHaveBeenCalledTimes(2);
    expect(rendered.container.textContent).toContain('採用済み');
    expect(rendered.container.textContent).toContain('採用した値は、表示中の候補値と同じです');
  });

  it('採用した後で OGT の値が変わったら、変わった区分を知らせる（採用値は自動で変えない）', async () => {
    vi.mocked(getOgtCandidates).mockResolvedValue({
      candidates: fictionalOgtCandidates.map((candidate, index) =>
        index === 0 ? { ...candidate, value: { state: 'answered' as const, value: '900.000' } } : candidate),
      suppliers: fictionalSupplierReferences,
    });
    vi.mocked(getOgtAdoption).mockResolvedValue(fictionalGhgAdoption);
    rendered = render(<SsbjOgtCandidates reportId={report.id} />);
    await settle();
    const alert = Array.from(rendered.container.querySelectorAll('[role="alert"]'))
      .find(element => element.textContent?.includes('採用した後で OGT の値が変わりました'));
    expect(alert?.textContent).toContain('Scope 1');
    expect(adoptOgtCandidates).not.toHaveBeenCalled();
  });

  it('サーバが「表示から変わった」と拒否したら、理由を表示して採用済みにしない', async () => {
    vi.mocked(adoptOgtCandidates).mockRejectedValue(new Error('OGT の値が画面の表示から変わりました'));
    rendered = render(<SsbjOgtCandidates reportId={report.id} />);
    await settle();
    await act(async () => { click(buttonByText(rendered!.container, '表示中の候補値を採用する')); });
    await act(async () => { click(dialogButton('採用する')); await Promise.resolve(); });
    await settle();
    expect(document.body.textContent).toContain('OGT の値が画面の表示から変わりました');
    expect(rendered.container.textContent).toContain('まだ採用していません');
  });

  it('採用済みなら取り消せる', async () => {
    vi.mocked(getOgtAdoption).mockResolvedValue(fictionalGhgAdoption);
    rendered = render(<SsbjOgtCandidates reportId={report.id} />);
    await settle();
    await act(async () => { click(buttonByText(rendered!.container, '採用を取り消す')); });
    vi.mocked(getOgtAdoption).mockResolvedValue(null);
    await act(async () => { click(dialogButton('取り消す')); await Promise.resolve(); });
    await settle();
    expect(clearOgtAdoption).toHaveBeenCalledWith(report.id);
    expect(rendered.container.textContent).toContain('まだ採用していません');
  });
});
