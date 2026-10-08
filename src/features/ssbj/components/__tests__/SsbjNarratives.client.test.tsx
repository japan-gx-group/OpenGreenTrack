// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { FICTIONAL_DRAFT_REVIEW, fictionalNarratives, fictionalReportBasicInfo, fictionalSnapshot } from '../../__fixtures__/fictionalReport';

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()), getSsbjReport: vi.fn(),
}));
vi.mock('../../services/narrativeService', () => ({ listSsbjNarratives: vi.fn(), saveSsbjNarrative: vi.fn() }));
// 右側のプレビュー・OGT の値（SsbjEditorLayout）が読む I/O。
vi.mock('../../services/previewService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/previewService')>()), getSsbjWorkingPreview: vi.fn(),
}));
vi.mock('../../services/ogtCandidateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/ogtCandidateService')>()),
  getOgtCandidates: vi.fn(async () => ({ candidates: [], suppliers: [] })),
}));
vi.mock('../../services/ogtAdoptionService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/ogtAdoptionService')>()), getOgtAdoption: vi.fn(async () => null),
}));

import { listSsbjNarratives, saveSsbjNarrative } from '../../services/narrativeService';
import { getSsbjWorkingPreview } from '../../services/previewService';
import { getSsbjReport } from '../../services/reportService';
import { SSBJ_NARRATIVE_ITEMS } from '../../utils/requirementMaster';
import { SsbjNarratives } from '../SsbjNarratives.client';

const report = { ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', draftRevision: 1, basicInfoRevision: 0, review: FICTIONAL_DRAFT_REVIEW };
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
  vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 1, snapshot: fictionalSnapshot });
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

describe('SsbjNarratives（穴埋めテンプレート・2 画面エディタ・承認ロック）', () => {
  const preview = () => document.querySelector('[data-testid="ssbj-editor-preview"]')?.textContent ?? '';

  it('テンプレートを入れると【 】の数を出し、置き換えないまま入力済みでは保存しない', async () => {
    rendered = render(<SsbjNarratives reportId={report.id} />);
    await settle();
    const card = cardOf('経営者の役割');
    click(buttonIn(card, '編集'));
    click(buttonIn(card, 'テンプレートを入れる'));
    const textarea = card.querySelector<HTMLTextAreaElement>('textarea[aria-label="開示する文章"]')!;
    expect(textarea.value).toContain('【任せている役員・会議体（例: 管理本部長）】');
    expect(card.querySelector('select')?.value).toBe('answered');
    expect(card.querySelector('[data-testid="ssbj-template-placeholders"]')?.textContent).toContain('4 か所');
    await act(async () => { click(buttonIn(card, '保存')); });
    expect(saveSsbjNarrative).not.toHaveBeenCalled();
    expect(card.querySelector('[role="alert"]')?.textContent).toContain('【 】の部分（4 か所）');
  });

  describe('本文が入力された状態から、入力済み以外で保存する', () => {
    const DRAFT = '当社では、管理本部長に【任せている内容（例: 気候関連のリスク及び機会の評価・管理）】を委任している。';
    const discardDialog = () => document.querySelector<HTMLElement>('[data-testid="ssbj-narrative-discard-dialog"]');

    /** テンプレートの一部だけを書き換えた本文を入れ、状態を「未確認」にして保存を押す（指摘の再現手順）。 */
    const saveDraftAsUnconfirmed = async (card: HTMLElement) => {
      click(buttonIn(card, '編集'));
      click(buttonIn(card, 'テンプレートを入れる'));
      setTextareaValue(card.querySelector<HTMLTextAreaElement>('textarea[aria-label="開示する文章"]')!, DRAFT);
      await act(async () => { click(buttonIn(card, '保存')); });
      expect(card.querySelector('[role="alert"]')?.textContent).toContain('文章を内部メモに移してから');
      setSelectValue(card.querySelector('select')!, 'unconfirmed');
      setTextareaValue(card.querySelector<HTMLTextAreaElement>(`textarea[id$="-internal-note"]`)!, '親会社と調整中');
      await act(async () => { click(buttonIn(card, '保存')); });
    };

    it('保存の前に、本文が保存されないことを警告する', async () => {
      rendered = render(<SsbjNarratives reportId={report.id} />);
      await settle();
      await saveDraftAsUnconfirmed(cardOf('経営者の役割'));
      expect(saveSsbjNarrative).not.toHaveBeenCalled();
      expect(discardDialog()?.textContent).toContain('「未確認」で保存すると、本文は保存されず空になります。');
      expect(discardDialog()?.textContent).toContain('書きかけの文章を残す場合は、内部メモに移してから保存してください。');
    });

    it('取り消すと保存せず、入力した本文を残したまま編集に戻る', async () => {
      rendered = render(<SsbjNarratives reportId={report.id} />);
      await settle();
      const card = cardOf('経営者の役割');
      await saveDraftAsUnconfirmed(card);
      click(buttonIn(discardDialog()!, '編集に戻る'));
      await settle();
      expect(discardDialog()).toBeNull();
      expect(saveSsbjNarrative).not.toHaveBeenCalled();
      setSelectValue(card.querySelector('select')!, 'answered');
      expect(card.querySelector<HTMLTextAreaElement>('textarea[aria-label="開示する文章"]')?.value).toBe(DRAFT);
    });

    it('確認して保存を続けると、本文は保存せず内部メモは残し、未確認の本文を開示欄にもプレビューにも出さない', async () => {
      vi.mocked(saveSsbjNarrative).mockImplementation(async (_report, itemId, text) => ({ itemId, text }));
      rendered = render(<SsbjNarratives reportId={report.id} />);
      await settle();
      await saveDraftAsUnconfirmed(cardOf('経営者の役割'));
      expect(preview()).not.toContain('管理本部長に【');
      await act(async () => { click(buttonIn(discardDialog()!, '本文を空にして保存')); });
      await settle();
      expect(saveSsbjNarrative).toHaveBeenCalledTimes(1);
      expect(saveSsbjNarrative).toHaveBeenCalledWith(
        expect.objectContaining({ id: report.id }),
        'governance.management_role',
        { disclosure: { state: 'unconfirmed' }, internalNote: '親会社と調整中' },
      );
      const card = cardOf('経営者の役割');
      expect(card.querySelector('form')).toBeNull();
      expect(card.textContent).toContain('未確認');
      expect(card.textContent).toContain('親会社と調整中');
      expect(card.textContent).not.toContain('管理本部長に【');
    });

    it('入力した本文が無ければ、警告せずに保存する', async () => {
      vi.mocked(saveSsbjNarrative).mockImplementation(async (_report, itemId, text) => ({ itemId, text }));
      rendered = render(<SsbjNarratives reportId={report.id} />);
      await settle();
      const card = cardOf('経営者の役割');
      click(buttonIn(card, '編集'));
      setSelectValue(card.querySelector('select')!, 'unconfirmed');
      await act(async () => { click(buttonIn(card, '保存')); });
      await settle();
      expect(discardDialog()).toBeNull();
      expect(saveSsbjNarrative).toHaveBeenCalledWith(
        expect.anything(), 'governance.management_role', { disclosure: { state: 'unconfirmed' }, internalNote: null },
      );
    });
  });

  it('編集中の文章を右側のプレビューにその場で出し、キャンセルすると保存済みの文章に戻す', async () => {
    rendered = render(<SsbjNarratives reportId={report.id} />);
    await settle();
    const card = cardOf('監督する機関・責任者');
    click(buttonIn(card, '編集'));
    setTextareaValue(card.querySelector<HTMLTextAreaElement>('textarea[aria-label="開示する文章"]')!, '入力途中の監督体制の文章。');
    await settle();
    expect(preview()).toContain('入力途中の監督体制の文章。');
    expect(document.querySelector('[data-testid="ssbj-editor-unsaved"]')).not.toBeNull();
    click(buttonIn(card, 'キャンセル'));
    await settle();
    expect(preview()).not.toContain('入力途中の監督体制の文章。');
    expect(preview()).toContain('当社では、取締役会が気候関連のリスク及び機会を監督している。');
  });

  it('承認済みのレポートでは編集の操作を出さず、ロックの案内を出す', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue({
      ...report,
      review: { ...report.review, status: 'approved', approverUserId: 'u', approvedAt: '2025-06-05T00:00:00.000Z', approvedByUserId: 'u' },
    });
    rendered = render(<SsbjNarratives reportId={report.id} />);
    await settle();
    expect(cards().length).toBeGreaterThan(0);
    expect(cards().some(card => Array.from(card.querySelectorAll('button')).some(button => button.textContent?.includes('編集')))).toBe(false);
    expect(document.querySelector('[data-testid="ssbj-locked-notice"]')).not.toBeNull();
  });
});
