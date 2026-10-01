// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { fictionalNarratives, fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()), getSsbjReport: vi.fn(),
}));
vi.mock('../../services/narrativeService', () => ({ listSsbjNarratives: vi.fn(), saveSsbjNarrative: vi.fn() }));

import { listSsbjNarratives, saveSsbjNarrative } from '../../services/narrativeService';
import { getSsbjReport } from '../../services/reportService';
import { SSBJ_NARRATIVE_ITEMS } from '../../utils/requirementMaster';
import { SsbjNarratives } from '../SsbjNarratives.client';

const report = { ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', draftRevision: 1 };
let rendered: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const settle = async () => { for (let i = 0; i < 4; i += 1) await flush(); };

/** React の onChange を発火させる（ネイティブの setter で値を入れてからイベントを流す）。 */
const setSelectValue = (select: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const setTextareaValue = (textarea: HTMLTextAreaElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ssbj-narrative-item"]'));
const cardOf = (label: string) => {
  const card = cards().find(element => element.querySelector('h3')?.textContent === label);
  if (!card) throw new Error(`項目「${label}」が見つかりません`);
  return card;
};
const buttonIn = (root: ParentNode, text: string) => {
  const button = Array.from(root.querySelectorAll('button')).find(element => element.textContent?.trim().endsWith(text));
  if (!button) throw new Error(`ボタン「${text}」が見つかりません`);
  return button;
};

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(report);
  vi.mocked(listSsbjNarratives).mockResolvedValue(fictionalNarratives);
});
afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjNarratives', () => {
  it('マスターの全項目を章ごとに並べ、文章の無い項目は未入力、要求と項番号を出す', async () => {
    rendered = render(<SsbjNarratives reportId={report.id} />);
    await settle();
    expect(cards()).toHaveLength(SSBJ_NARRATIVE_ITEMS.length);
    const oversight = cardOf('監督する機関・責任者');
    expect(oversight.textContent).toContain('当社では、取締役会が気候関連のリスク及び機会を監督している。');
    expect(oversight.textContent).toContain('REQ-GEN-001');
    expect(oversight.textContent).toContain('気候基準 10(1)');
    expect(cardOf('経営者の役割').textContent).toContain('未入力');
    expect(cardOf('ビジネス・モデルとバリュー・チェーンへの影響').textContent).toContain('未確認');
  });

  it('文章以外の画面で答える要求は、どこで答えるかを案内する', async () => {
    rendered = render(<SsbjNarratives reportId={report.id} />);
    await settle();
    const link = Array.from(rendered.container.querySelectorAll('a')).find(a => a.textContent === 'リスク・機会');
    expect(link?.getAttribute('href')).toBe(`/ssbj/${report.id}/risks`);
  });

  it('項目を編集して保存すると、その項目だけを保存して表示を差し替える', async () => {
    vi.mocked(saveSsbjNarrative).mockImplementation(async (_report, itemId, text) => ({ itemId, text }));
    rendered = render(<SsbjNarratives reportId={report.id} />);
    await settle();
    const card = cardOf('経営者の役割');
    click(buttonIn(card, '編集'));
    setSelectValue(card.querySelector('select')!, 'answered');
    setTextareaValue(card.querySelector<HTMLTextAreaElement>('textarea[aria-label="開示する文章"]')!, ' 管理本部長に委任している。 ');
    await act(async () => { click(buttonIn(card, '保存')); });
    await settle();
    expect(saveSsbjNarrative).toHaveBeenCalledWith(
      expect.objectContaining({ id: report.id, organizationId: report.organizationId }),
      'governance.management_role',
      { disclosure: { state: 'answered', value: '管理本部長に委任している。' }, internalNote: null },
    );
    expect(cardOf('経営者の役割').textContent).toContain('管理本部長に委任している。');
  });

  it('入力済みなのに本文が空なら保存せず、理由を出す', async () => {
    rendered = render(<SsbjNarratives reportId={report.id} />);
    await settle();
    const card = cardOf('経営者の役割');
    click(buttonIn(card, '編集'));
    setSelectValue(card.querySelector('select')!, 'answered');
    await act(async () => { click(buttonIn(card, '保存')); });
    expect(saveSsbjNarrative).not.toHaveBeenCalled();
    expect(card.querySelector('[role="alert"]')?.textContent).toContain('開示する文章を入力してください');
  });

  it('存在しない・他組織のレポートでは文章を取得しない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    rendered = render(<SsbjNarratives reportId="other" />);
    await settle();
    expect(rendered.container.textContent).toContain('SSBJレポートが見つかりません');
    expect(listSsbjNarratives).not.toHaveBeenCalled();
  });
});
