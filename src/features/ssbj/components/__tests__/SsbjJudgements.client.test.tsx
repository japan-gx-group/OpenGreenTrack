// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import {
  FICTIONAL_DRAFT_REVIEW,
  fictionalJudgements,
  fictionalReportBasicInfo,
  fictionalRisksOpportunities,
} from '../../__fixtures__/fictionalReport';

// SSBJ 該当性・重要性の判断画面: マスターの全要求の表示（判断の無い要求は未確認）、件数と絞り込み、
// 編集ダイアログからの保存（検証・一覧への反映）、Not Found を検証する。Supabase を呼ぶ I/O だけをモックする。

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()), getSsbjReport: vi.fn(),
}));
vi.mock('../../services/judgementService', () => ({
  listSsbjJudgements: vi.fn(), saveSsbjJudgement: vi.fn(), saveSsbjJudgementQuickChange: vi.fn(),
}));
vi.mock('../../services/riskOpportunityService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/riskOpportunityService')>()), listSsbjRisksOpportunities: vi.fn(),
}));


// SSBJ のロールは、既定で入力担当として操作する（編集の操作を出す）。
vi.mock('../../services/memberRoleService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberRoleService')>()),
  getMySsbjRole: vi.fn(async () => 'editor'),
}));
import { listSsbjJudgements, saveSsbjJudgement, saveSsbjJudgementQuickChange } from '../../services/judgementService';
import { getSsbjReport } from '../../services/reportService';
import { listSsbjRisksOpportunities } from '../../services/riskOpportunityService';
import { SSBJ_REQUIREMENTS } from '../../utils/requirementMaster';
import { SsbjEditConflictError } from '../../utils/writeError';
import { SsbjJudgements } from '../SsbjJudgements.client';

const report = { ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', draftRevision: 1, basicInfoRevision: 0, review: FICTIONAL_DRAFT_REVIEW };
// 読み込んだ行の更新日時（一覧から保存するときの競合検知の条件）。保存のたびに進める。
const LOADED_AT = '2025-06-01T00:00:00.000000+00:00';
const SAVED_AT = '2025-06-02T00:00:00.000000+00:00';
const JUDGEMENTS = fictionalJudgements.map(judgement => ({ ...judgement, updatedAt: LOADED_AT }));
const RISKS = fictionalRisksOpportunities.map(item => ({ ...item, updatedAt: LOADED_AT }));
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
  vi.mocked(listSsbjJudgements).mockResolvedValue(JUDGEMENTS);
  vi.mocked(listSsbjRisksOpportunities).mockResolvedValue(RISKS);
  vi.mocked(saveSsbjJudgement).mockImplementation(async (_report, judgement) => ({ ...judgement, updatedAt: SAVED_AT }));
  vi.mocked(saveSsbjJudgementQuickChange).mockImplementation(async (_report, _savedAt, judgement) => ({ ...judgement, updatedAt: SAVED_AT }));
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
    // 記録のある 5 件のうち、REQ-APP-002（記載しない旨の説明が未入力）と REQ-GEN-001（根拠が未入力）が要確認、残り 3 件が判断済み。
    expect(document.querySelector('[data-testid="ssbj-judgement-status-count"]')?.textContent)
      .toContain(`未判断 ${SSBJ_REQUIREMENTS.length - 5} 件 / 要確認 2 件 / 判断済み 3 件`);
    expect(rowOf('REQ-GEN-001').textContent).toContain('根拠が未入力');
  });

  it('未判断・要確認・判断済み、リスク・機会に関連する要求で絞り込める', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    const filter = document.getElementById('ssbj-judgements-filter') as HTMLSelectElement;
    setSelectValue(filter, 'undecided');
    expect(rows()).toHaveLength(SSBJ_REQUIREMENTS.length - 5);
    setSelectValue(filter, 'needs_review');
    expect(rows().map(row => row.dataset.requirementId)).toEqual(['REQ-GEN-001', 'REQ-APP-002']);
    setSelectValue(filter, 'decided');
    expect(rows().map(row => row.dataset.requirementId).sort()).toEqual(['REQ-CLM-020', 'REQ-CLM-023', 'REQ-CLM-027']);
    setSelectValue(filter, 'all');
    expect(rows()).toHaveLength(SSBJ_REQUIREMENTS.length);
  });

  it('リスク・機会で関連付けたマスターの項目が答える要求に、そのリスク・機会を出す', async () => {
    vi.mocked(listSsbjRisksOpportunities).mockResolvedValue([
      { ...RISKS[0], linkTargets: ['strategy', 'strategy.business_model_impact'] },
    ]);
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    expect(rowOf('REQ-CLM-009').querySelector('[data-testid="ssbj-judgement-related-risks"]')?.textContent)
      .toContain(fictionalRisksOpportunities[0].title);
    setSelectValue(document.getElementById('ssbj-judgements-filter') as HTMLSelectElement, 'with_risks');
    expect(rows().map(row => row.dataset.requirementId)).toEqual(['REQ-GEN-007', 'REQ-CLM-009']);
  });

  it('一覧で該当性・重要性を続けて選ぶと、その都度保存し、記載しない理由・説明・根拠は変えない', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    const applicability = () => rowOf('REQ-GEN-002').querySelector<HTMLSelectElement>('select[aria-label="REQ-GEN-002 の該当性"]')!;
    const materiality = () => rowOf('REQ-GEN-002').querySelector<HTMLSelectElement>('select[aria-label="REQ-GEN-002 の重要性"]')!;
    await act(async () => { setSelectValue(applicability(), 'applicable'); });
    await settle();
    await act(async () => { setSelectValue(materiality(), 'material'); });
    await settle();
    expect(saveSsbjJudgementQuickChange).toHaveBeenCalledTimes(2);
    expect(saveSsbjJudgement).not.toHaveBeenCalled();
    // 行が無い要求は作る（null）。2 回目は 1 回目に作った行の更新日時を条件にする。
    expect(vi.mocked(saveSsbjJudgementQuickChange).mock.calls[0][1]).toBeNull();
    expect(vi.mocked(saveSsbjJudgementQuickChange).mock.calls[1][1]).toBe(SAVED_AT);
    expect(vi.mocked(saveSsbjJudgementQuickChange).mock.calls[1][2]).toMatchObject({
      requirementId: 'REQ-GEN-002', applicability: 'applicable', materiality: 'material', omissionReason: 'none',
      explanation: { disclosure: { state: 'unanswered' }, internalNote: null },
    });
    // 一覧の選択だけでは根拠が無いので、要確認のまま。
    expect(rowOf('REQ-GEN-002').textContent).toContain('要確認');
    expect(rowOf('REQ-GEN-002').textContent).toContain('根拠が未入力');

    await act(async () => { setSelectValue(rowOf('REQ-CLM-020').querySelector<HTMLSelectElement>('select[aria-label="REQ-CLM-020 の重要性"]')!, 'unconfirmed'); });
    await settle();
    expect(vi.mocked(saveSsbjJudgementQuickChange).mock.calls[2][1]).toBe(LOADED_AT);
    expect(vi.mocked(saveSsbjJudgementQuickChange).mock.calls[2][2]).toMatchObject({
      ...fictionalJudgements.find(judgement => judgement.requirementId === 'REQ-CLM-020')!, materiality: 'unconfirmed',
    });
  });

  it('一覧から保存しようとして、読込後に他の画面で保存されていたら、上書きせずに理由を出して最新を読み直す', async () => {
    vi.mocked(saveSsbjJudgementQuickChange).mockRejectedValueOnce(new SsbjEditConflictError());
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    expect(listSsbjJudgements).toHaveBeenCalledTimes(1);
    await act(async () => { setSelectValue(rowOf('REQ-CLM-020').querySelector<HTMLSelectElement>('select[aria-label="REQ-CLM-020 の重要性"]')!, 'unconfirmed'); });
    await settle();
    expect(rowOf('REQ-CLM-020').querySelector('[role="alert"]')?.textContent).toContain('他の画面で更新されました');
    expect(listSsbjJudgements).toHaveBeenCalledTimes(2);
    expect(rowOf('REQ-CLM-020').querySelector<HTMLSelectElement>('select[aria-label="REQ-CLM-020 の重要性"]')!.value).toBe('material');
  });

  it('一覧の選択でも詳細と同じ検証を通し、通らなければ保存せずに理由を出す', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    // REQ-CLM-027 は「重要性がない」を理由にしているので、重要性を「重要性あり」にはできない。
    await act(async () => { setSelectValue(rowOf('REQ-CLM-027').querySelector<HTMLSelectElement>('select[aria-label="REQ-CLM-027 の重要性"]')!, 'material'); });
    await settle();
    expect(saveSsbjJudgementQuickChange).not.toHaveBeenCalled();
    expect(rowOf('REQ-CLM-027').querySelector('[role="alert"]')?.textContent).toContain('「詳細」から直してください');
    expect(rowOf('REQ-CLM-027').querySelector<HTMLSelectElement>('select[aria-label="REQ-CLM-027 の重要性"]')!.value).toBe('not_material');
  });

  it('案内どおり「詳細」から直して保存すると、行の案内は消える', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    const materiality = () => rowOf('REQ-CLM-027').querySelector<HTMLSelectElement>('select[aria-label="REQ-CLM-027 の重要性"]')!;
    await act(async () => { setSelectValue(materiality(), 'material'); });
    await settle();
    expect(rowOf('REQ-CLM-027').querySelector('[role="alert"]')?.textContent).toContain('「詳細」から直してください');
    expect(materiality().getAttribute('aria-describedby')).toBe('ssbj-judgement-error-REQ-CLM-027');
    click(buttonIn(rowOf('REQ-CLM-027'), '詳細'));
    await flush();
    setSelectValue(selectLabeled('記載しない理由'), 'none');
    setSelectValue(selectLabeled('重要性'), 'material');
    await act(async () => { click(buttonIn(dialog(), '変更を保存')); });
    await settle();
    expect(saveSsbjJudgement).toHaveBeenCalledTimes(1);
    expect(materiality().value).toBe('material');
    expect(rowOf('REQ-CLM-027').querySelector('[role="alert"]')).toBeNull();
    expect(materiality().hasAttribute('aria-describedby')).toBe(false);
  });

  it('保存中も選択欄は無効にせず（フォーカスを外さない）、保存が終わるまで次の選択は受け付けない', async () => {
    let finish: () => void = () => {};
    vi.mocked(saveSsbjJudgementQuickChange).mockImplementationOnce((_report, _savedAt, judgement) =>
      new Promise(resolve => { finish = () => resolve({ ...judgement, updatedAt: SAVED_AT }); }));
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    const applicability = () => rowOf('REQ-GEN-002').querySelector<HTMLSelectElement>('select[aria-label="REQ-GEN-002 の該当性"]')!;
    await act(async () => { setSelectValue(applicability(), 'applicable'); });
    expect(applicability().disabled).toBe(false);
    expect(applicability().getAttribute('aria-busy')).toBe('true');
    expect(rowOf('REQ-GEN-002').querySelector('[role="status"]')?.textContent).toBe('保存中...');
    await act(async () => { setSelectValue(applicability(), 'not_applicable'); });
    expect(saveSsbjJudgementQuickChange).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await settle();
    expect(applicability().value).toBe('applicable');
    expect(rowOf('REQ-GEN-002').querySelector('[role="status"]')).toBeNull();
  });

  it('閉じた選択欄で ↑↓ を押すと、値を変えずに選択肢の一覧を開く（途中の値を保存しない）', async () => {
    const showPicker = vi.fn();
    Object.defineProperty(window.HTMLSelectElement.prototype, 'showPicker', { value: showPicker, configurable: true });
    try {
      rendered = render(<SsbjJudgements reportId={report.id} />);
      await settle();
      const select = rowOf('REQ-GEN-002').querySelector<HTMLSelectElement>('select[aria-label="REQ-GEN-002 の該当性"]')!;
      const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      act(() => { select.dispatchEvent(down); });
      expect(showPicker).toHaveBeenCalledTimes(1);
      expect(down.defaultPrevented).toBe(true);
      const altDown = new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true });
      act(() => { select.dispatchEvent(altDown); });
      expect(showPicker).toHaveBeenCalledTimes(1);
      expect(saveSsbjJudgementQuickChange).not.toHaveBeenCalled();
    } finally {
      delete (window.HTMLSelectElement.prototype as { showPicker?: unknown }).showPicker;
    }
  });

  it('一覧で選んだ結果は、詳細を開くとそのまま出て、詳細で保存した結果は一覧に出る（同じ保存結果）', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    await act(async () => { setSelectValue(rowOf('REQ-GEN-002').querySelector<HTMLSelectElement>('select[aria-label="REQ-GEN-002 の該当性"]')!, 'not_applicable'); });
    await settle();
    click(buttonIn(rowOf('REQ-GEN-002'), '詳細'));
    await flush();
    expect(selectLabeled('該当性').value).toBe('not_applicable');
    setTextareaValue(dialog().querySelector<HTMLTextAreaElement>('textarea:not([aria-label])')!, '該当する体制が無い');
    await act(async () => { click(buttonIn(dialog(), '変更を保存')); });
    await settle();
    expect(saveSsbjJudgementQuickChange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveSsbjJudgement).mock.calls[0][1]).toEqual({
      requirementId: 'REQ-GEN-002', applicability: 'not_applicable', materiality: 'unconfirmed', omissionReason: 'none',
      explanation: { disclosure: { state: 'unanswered' }, internalNote: '該当する体制が無い' },
    });
    expect(rowOf('REQ-GEN-002').querySelector<HTMLSelectElement>('select[aria-label="REQ-GEN-002 の該当性"]')!.value).toBe('not_applicable');
    expect(rowOf('REQ-GEN-002').textContent).toContain('判断済み');
  });

  it('詳細の「保存して次の未判断・要確認へ」で、表示中の次の要求を開く', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    setSelectValue(document.getElementById('ssbj-judgements-filter') as HTMLSelectElement, 'needs_review');
    click(buttonIn(rowOf('REQ-GEN-001'), '詳細'));
    await flush();
    setTextareaValue(dialog().querySelector<HTMLTextAreaElement>('textarea:not([aria-label])')!, '取締役会規程で確認');
    await act(async () => { click(buttonIn(dialog(), '保存して次の未判断・要確認へ')); });
    await settle();
    expect(vi.mocked(saveSsbjJudgement).mock.calls[0][1].requirementId).toBe('REQ-GEN-001');
    expect(dialog().textContent).toContain('REQ-APP-002');
  });

  it('ダイアログで判断を編集して保存すると、その要求だけを保存して表示を差し替える', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    click(buttonIn(rowOf('REQ-CLM-026'), '詳細'));
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
    expect(rowOf('REQ-CLM-026').querySelector<HTMLSelectElement>('select[aria-label="REQ-CLM-026 の重要性"]')!.value)
      .toBe('not_material');
  });

  it('「重要性がない」を理由にしたのに重要性が「重要性なし」でなければ保存しない', async () => {
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    click(buttonIn(rowOf('REQ-CLM-026'), '詳細'));
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

describe('SsbjJudgements（承認ロック）', () => {
  it('承認済みのレポートでは編集の操作を出さず、ロックの案内を出す', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue({ ...report, review: { status: 'approved' as const, approverUserId: 'u', approvedAt: '2025-06-05T00:00:00.000Z', approvedByUserId: 'u',
      approvedVersionId: null, statusChangedAt: null, reviewRequestedByUserId: null } });
    rendered = render(<SsbjJudgements reportId={report.id} />);
    await settle();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().some(row => row.textContent?.includes('詳細'))).toBe(false);
    expect(rows().some(row => row.querySelector('select') !== null)).toBe(false);
    expect(document.querySelector('[data-testid="ssbj-locked-notice"]')).not.toBeNull();
  });
});
