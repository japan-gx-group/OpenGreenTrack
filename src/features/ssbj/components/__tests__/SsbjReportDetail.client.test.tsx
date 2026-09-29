// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';
import type { SsbjReportWorkingRecord } from '../../types';

// SSBJ レポート詳細画面: 基本情報の再表示・未入力の表示・Not Found・編集保存・保存版の作成を検証する。

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()),
  getSsbjReport: vi.fn(),
  updateSsbjReportBasicInfo: vi.fn(),
}));

vi.mock('../../services/versionClient', () => ({
  saveSsbjReportVersion: vi.fn(),
}));

import { getSsbjReport, updateSsbjReportBasicInfo } from '../../services/reportService';
import { saveSsbjReportVersion } from '../../services/versionClient';
import { SsbjReportDetail } from '../SsbjReportDetail.client';

const REPORT: SsbjReportWorkingRecord = {
  ...fictionalReportBasicInfo,
  standardVersion: null,
  fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01',
  periodEnd: '2025-03-31',
  draftRevision: 3,
};

const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const findButton = (container: ParentNode, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    element => element.textContent?.trim() === label,
  );
  if (!button) throw new Error(`ボタンが見つかりません: ${label}`);
  return button;
};

let rendered: RenderResult | null = null;

const renderScreen = async (reportId = REPORT.id): Promise<RenderResult> => {
  rendered = render(<SsbjReportDetail reportId={reportId} />);
  await flushPromises();
  return rendered;
};

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.clearAllMocks();
});

describe('SsbjReportDetail', () => {
  it('基本情報と対象年度を表示し、未入力の項目は「未入力」と表示する', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const { container } = await renderScreen();

    expect(getSsbjReport).toHaveBeenCalledWith(REPORT.id);
    const text = container.textContent ?? '';
    expect(text).toContain(REPORT.purpose ?? '');
    expect(text).toContain('2024年度（2024-04-01 〜 2025-03-31）');
    const standardVersionRow = Array.from(container.querySelectorAll('dt')).find(
      dt => dt.textContent === '参照する基準の版',
    );
    expect(standardVersionRow?.nextElementSibling?.textContent).toBe('未入力');
  });

  it('存在しない・他組織のレポートは「見つかりません」を表示し、内容を出さない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    const { container } = await renderScreen('5b1f0000-0000-4000-8000-0000000000ff');

    expect(container.textContent).toContain('SSBJレポートが見つかりません');
    expect(container.querySelector('dl')).toBeNull();
  });

  it('取得エラーは Not Found と区別して表示する', async () => {
    vi.mocked(getSsbjReport).mockRejectedValue(new Error('SSBJレポートの取得に失敗しました'));
    const { container } = await renderScreen();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('SSBJレポートの取得に失敗しました');
    expect(container.textContent).not.toContain('SSBJレポートが見つかりません');
  });

  it('編集して保存すると更新後の内容を再表示する', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const updated: SsbjReportWorkingRecord = { ...REPORT, title: '改訂後のレポート名', draftRevision: 4 };
    vi.mocked(updateSsbjReportBasicInfo).mockResolvedValue(updated);
    const { container } = await renderScreen();

    click(findButton(container, '編集'));
    const titleInput = container.querySelector<HTMLInputElement>('input[name="title"]');
    if (!titleInput) throw new Error('レポート名の入力欄がありません');
    expect(titleInput.value).toBe(REPORT.title);

    setInputValue(titleInput, '改訂後のレポート名');
    click(findButton(container, '変更を保存'));
    await flushPromises();

    expect(updateSsbjReportBasicInfo).toHaveBeenCalledWith(REPORT.id, {
      title: '改訂後のレポート名',
      purpose: REPORT.purpose,
      reportingScope: REPORT.reportingScope,
      standardVersion: null,
      parentCompanyName: REPORT.parentCompanyName,
      parentRelationship: REPORT.parentRelationship,
      ownershipPercentage: REPORT.ownershipPercentage,
      measurementApproach: REPORT.measurementApproach,
      industryCode: REPORT.industryCode,
    });
    expect(container.querySelector('input[name="title"]')).toBeNull();
    expect(container.querySelector('dl')?.textContent).toContain('改訂後のレポート名');
  });

  it('親会社との関係・持分比率・測定アプローチ・業種を表示し、業種には産業別ガイダンスの巻へのリンクを出す', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const { container } = await renderScreen();

    const text = container.querySelector('dl')?.textContent ?? '';
    expect(text).toContain('架空サンプルホールディングス株式会社');
    expect(text).toContain('連結子会社');
    expect(text).toContain('100%');
    expect(text).toContain('経営支配力アプローチ');
    expect(text).toContain('RT-IG 工業用機械及び製品');
    const link = container.querySelector<HTMLAnchorElement>('dl a');
    expect(link?.href).toBe('https://www.ssb-j.jp/jp/wp-content/uploads/sites/6/s2-50_20231020.pdf');
    expect(link?.textContent).toContain('第50巻');
  });

  it('業種と持分比率を編集すると、選んだ値で保存する。持分比率の形式が違えば保存しない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(updateSsbjReportBasicInfo).mockResolvedValue({ ...REPORT, industryCode: 'TR-RO', ownershipPercentage: '35' });
    const { container } = await renderScreen();

    click(findButton(container, '編集'));
    const industry = container.querySelector<HTMLSelectElement>('select[name="industryCode"]');
    const ownership = container.querySelector<HTMLInputElement>('input[name="ownershipPercentage"]');
    if (!industry || !ownership) throw new Error('業種・持分比率の入力欄がありません');
    const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    act(() => {
      selectSetter?.call(industry, 'TR-RO');
      industry.dispatchEvent(new Event('change', { bubbles: true }));
    });

    setInputValue(ownership, '101');
    click(findButton(container, '変更を保存'));
    await flushPromises();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('持分比率は 0 より大きく 100 以下');
    expect(updateSsbjReportBasicInfo).not.toHaveBeenCalled();

    setInputValue(ownership, '35');
    click(findButton(container, '変更を保存'));
    await flushPromises();
    expect(vi.mocked(updateSsbjReportBasicInfo).mock.calls[0][1]).toMatchObject({
      industryCode: 'TR-RO',
      ownershipPercentage: '35',
    });
  });

  it('保存版の作成は、読込時の draftRevision を渡して版番号を知らせる', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(saveSsbjReportVersion).mockResolvedValue({ id: 'version-1', versionNumber: 2 });
    const { container } = await renderScreen();

    click(findButton(container, '保存版を作成'));
    await flushPromises();

    expect(saveSsbjReportVersion).toHaveBeenCalledWith(REPORT.id, 3);
    expect(container.textContent).toContain('版 2 として保存しました');
  });

  it('基本情報を保存した後は、更新後の draftRevision で保存版を作る', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(updateSsbjReportBasicInfo).mockResolvedValue({ ...REPORT, draftRevision: 4 });
    vi.mocked(saveSsbjReportVersion).mockResolvedValue({ id: 'version-1', versionNumber: 1 });
    const { container } = await renderScreen();

    click(findButton(container, '編集'));
    click(findButton(container, '変更を保存'));
    await flushPromises();
    click(findButton(container, '保存版を作成'));
    await flushPromises();

    expect(saveSsbjReportVersion).toHaveBeenCalledWith(REPORT.id, 4);
  });

  it('基本情報の編集中は保存版を作成できない（未保存の入力が保存版に入らないため）', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    const { container } = await renderScreen();

    click(findButton(container, '編集'));

    expect(findButton(container, '保存版を作成').disabled).toBe(true);
  });

  it('競合などで保存できなかった理由を表示する', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(REPORT);
    vi.mocked(saveSsbjReportVersion).mockRejectedValue(
      new Error('他の変更と競合しました。画面を開き直してから保存し直してください'),
    );
    const { container } = await renderScreen();

    click(findButton(container, '保存版を作成'));
    await flushPromises();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      '他の変更と競合しました。画面を開き直してから保存し直してください',
    );
  });
});
