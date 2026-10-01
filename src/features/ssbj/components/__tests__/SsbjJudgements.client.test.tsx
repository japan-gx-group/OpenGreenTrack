// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { fictionalJudgements, fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';

// SSBJ 該当性・重要性の判断画面: マスターの全要求の表示（判断の無い要求は未確認）、件数と絞り込み、
// 編集ダイアログからの保存（検証・一覧への反映）、Not Found を検証する。Supabase を呼ぶ I/O だけをモックする。

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()), getSsbjReport: vi.fn(),
}));
vi.mock('../../services/judgementService', () => ({ listSsbjJudgements: vi.fn(), saveSsbjJudgement: vi.fn() }));

import { listSsbjJudgements, saveSsbjJudgement } from '../../services/judgementService';
import { getSsbjReport } from '../../services/reportService';
import { SSBJ_REQUIREMENTS } from '../../utils/requirementMaster';
import { SsbjJudgements } from '../SsbjJudgements.client';

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

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ssbj-judgement-row"]'));
const rowOf = (requirementId: string) => {
  const row = rows().find(element => element.textContent?.includes(requirementId));
  if (!row) throw new Error(`要求「${requirementId}」の行が見つかりません`);
  return row;
};
const buttonIn = (root: ParentNode, text: string) => {
  const button = Array.from(root.querySelectorAll('button')).find(element => element.textContent?.trim().endsWith(text));
  if (!button) throw new Error(`ボタン「${text}」が見つかりません`);
  return button;
};
const dialog = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!element) throw new Error('ダイアログが開いていません');
  return element;
};
const selectLabeled = (label: string): HTMLSelectElement => {
  const labelElement = Array.from(dialog().querySelectorAll('label')).find(element => element.textContent === label);
  const select = labelElement && dialog().querySelector<HTMLSelectElement>(`#${CSS.escape(labelElement.htmlFor)}`);
  if (!select) throw new Error(`選択欄「${label}」が見つかりません`);
  return select;
};

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(report);
  vi.mocked(listSsbjJudgements).mockResolvedValue(fictionalJudgements);
});
afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjJudgements', () => {
  it('マスターの全要求を並べ、判断の無い要求は未確認、記録した判断と説明を出す', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    expect(rows()).toHaveLength(SSBJ_REQUIREMENTS.length);
    expect(rowOf('REQ-CLM-020').textContent).toContain('経過措置を適用');
    expect(rowOf('REQ-CLM-020').textContent).toContain('スコープ 3 のカテゴリー別の内訳を開示していない');
    expect(rowOf('REQ-APP-002').textContent).toContain('その旨の説明が未入力');
    expect(rowOf('REQ-GEN-002').textContent).toContain('未確認');
    // 判断の済んでいない要求 = マスターの要求から、該当で重要性を判断済みの 4 件と非該当の 1 件を除いたもの。
    expect(document.querySelector('[data-testid="ssbj-judgement-pending-count"]')?.textContent)
      .toContain(`${SSBJ_REQUIREMENTS.length - 5} / ${SSBJ_REQUIREMENTS.length} 件`);
  });

  it('判断が済んでいない要求だけに絞り込める', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    click(document.getElementById('ssbj-judgements-pending-only')!);
    await flush();
    expect(rows()).toHaveLength(SSBJ_REQUIREMENTS.length - 5);
    expect(rows().some(row => row.textContent?.includes('REQ-CLM-020'))).toBe(false);
  });

  it('ダイアログで判断を編集して保存すると、その要求だけを保存して表示を差し替える', async () => {
    vi.mocked(saveSsbjJudgement).mockImplementation(async (_report, judgement) => judgement);
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    click(buttonIn(rowOf('REQ-CLM-026'), '編集'));
    await flush();
    setSelectValue(selectLabeled('該当性'), 'applicable');
    setSelectValue(selectLabeled('重要性'), 'not_material');
    setSelectValue(selectLabeled('記載しない理由'), 'not_material');
    setTextareaValue(dialog().querySelector<HTMLTextAreaElement>('textarea:not([aria-label])')!, ' 導入予定なし ');
    await act(async () => { click(buttonIn(dialog(), '変更を保存')); });
    await settle();
    expect(saveSsbjJudgement).toHaveBeenCalledWith(
      expect.objectContaining({ id: report.id, organizationId: report.organizationId }),
      {
        requirementId: 'REQ-CLM-026',
        applicability: 'applicable',
        materiality: 'not_material',
        omissionReason: 'not_material',
        explanation: { disclosure: { state: 'unanswered' }, internalNote: '導入予定なし' },
      },
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rowOf('REQ-CLM-026').textContent).toContain('重要性なし');
  });

  it('「重要性がない」を理由にしたのに重要性が「重要性なし」でなければ保存しない', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    click(buttonIn(rowOf('REQ-CLM-026'), '編集'));
    await flush();
    setSelectValue(selectLabeled('記載しない理由'), 'not_material');
    await act(async () => { click(buttonIn(dialog(), '変更を保存')); });
    expect(saveSsbjJudgement).not.toHaveBeenCalled();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('重要性を「重要性なし」にしてください');
  });

  it('存在しない・他組織のレポートでは判断を取得しない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    rendered = render(<SsbjJudgements reportId="other" />);
    await settle();
    expect(rendered.container.textContent).toContain('SSBJレポートが見つかりません');
    expect(listSsbjJudgements).not.toHaveBeenCalled();
  });
});
