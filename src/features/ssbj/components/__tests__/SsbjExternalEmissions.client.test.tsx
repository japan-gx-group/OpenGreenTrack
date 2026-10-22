// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import {
  FICTIONAL_DRAFT_REVIEW, fictionalEvidence, fictionalExternalEmissions, fictionalReportBasicInfo,
} from '../../__fixtures__/fictionalReport';

// 外部算定値の画面: 一覧（区分・ガス・排出量・出典・根拠・確認）、必須項目の確認、保存、二重計上の理由の表示、
// ロール・根拠文書が無いときの出し分けを検証する（RLS・重なりの判定は DB 側で確認する）。

// フォームの中の Checkbox（Radix）は大きさを測るのに ResizeObserver を使うが、jsdom には無いので、何もしないものを置く。
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()),
  getSsbjReport: vi.fn(),
}));
vi.mock('../../services/externalEmissionService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/externalEmissionService')>()),
  listSsbjExternalEmissions: vi.fn(),
  createSsbjExternalEmission: vi.fn(),
  updateSsbjExternalEmission: vi.fn(),
  deleteSsbjExternalEmission: vi.fn(),
}));
vi.mock('../../services/evidenceService', () => ({ listSsbjEvidence: vi.fn() }));
vi.mock('../../services/memberService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberService')>()),
  listSsbjMembers: vi.fn(async () => [{ id: '5b1f0000-0000-4000-8000-000000000005', name: '環境 太郎', role: 'admin' }]),
  getCurrentSsbjUserId: vi.fn(async () => '5b1f0000-0000-4000-8000-000000000005'),
}));
vi.mock('../../services/memberRoleService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberRoleService')>()),
  getMySsbjRole: vi.fn(async () => 'editor'),
}));

import { listSsbjEvidence } from '../../services/evidenceService';
import {
  createSsbjExternalEmission, deleteSsbjExternalEmission, listSsbjExternalEmissions,
} from '../../services/externalEmissionService';
import { getMySsbjRole } from '../../services/memberRoleService';
import { listSsbjMembers } from '../../services/memberService';
import { getSsbjReport } from '../../services/reportService';
import { SsbjExternalEmissions } from '../SsbjExternalEmissions.client';
import type { SsbjExternalEmission } from '../../types';

const report = {
  ...fictionalReportBasicInfo, fiscalYearLabel: '2024年度', periodStart: '2024-04-01', periodEnd: '2025-03-31',
  draftRevision: 1, basicInfoRevision: 0, review: FICTIONAL_DRAFT_REVIEW,
};
const [stored] = fictionalExternalEmissions;
// 画面の一覧の行は、保存版にだけある資料名・確認者の名前を持たない。
const emission = Object.fromEntries(
  Object.entries(stored).filter(([key]) => key !== 'evidenceTitle' && key !== 'confirmedByName'),
) as SsbjExternalEmission;

let mounted: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const settle = async () => { for (let i = 0; i < 4; i += 1) await flush(); };
const button = (label: string, root: ParentNode = document) => {
  const found = [...root.querySelectorAll('button')].find(node => node.textContent?.trim().endsWith(label));
  if (!found) throw new Error(`ボタンが見つかりません: ${label}`);
  return found;
};
const setSelect = (id: string, value: string) => {
  const select = document.querySelector<HTMLSelectElement>(`#${id}`)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  act(() => { setter?.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); });
};
const setTextarea = (id: string, value: string) => {
  const textarea = document.querySelector<HTMLTextAreaElement>(`#${id}`)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => { setter?.call(textarea, value); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
};

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(report);
  vi.mocked(listSsbjEvidence).mockResolvedValue(fictionalEvidence);
  vi.mocked(listSsbjExternalEmissions).mockResolvedValue([emission]);
});
afterEach(() => { mounted?.unmount(); mounted = null; vi.clearAllMocks(); });

const open = async () => {
  mounted = render(<SsbjExternalEmissions reportId={report.id} />);
  await settle();
  return mounted;
};

describe('SsbjExternalEmissions', () => {
  it('区分・対象ガス・排出量と、出典（算定した者・方法）・根拠文書・確認を一覧に出す', async () => {
    const { container } = await open();
    const card = container.querySelector<HTMLElement>('[data-testid="ssbj-external-emission"]')!;
    expect(card.textContent).toContain('Scope 1：1.250 t-CO2e');
    expect(card.textContent).toContain('CH4・N2O');
    expect(card.textContent).toContain(stored.calculatedBy);
    expect(card.textContent).toContain('取締役会議事録（架空）');
    expect(card.textContent).toContain('環境 太郎');
  });

  it('必須項目が足りなければ保存せず、足りない項目を伝える', async () => {
    await open();
    await act(async () => { click(button('外部算定値を追加')); });
    await act(async () => { click(button('保存する')); });
    expect(createSsbjExternalEmission).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Scope を選んでください');
  });

  it('入力をそろえて保存し、DB が二重計上で拒否したときはその理由を出す', async () => {
    vi.mocked(createSsbjExternalEmission).mockRejectedValueOnce(
      new Error('この Scope・カテゴリの CO2 は、OGT の採用値に含まれています'),
    );
    await open();
    await act(async () => { click(button('外部算定値を追加')); });
    setSelect('external-scope', '1');
    await act(async () => { click(document.querySelector<HTMLElement>('[role="dialog"] [aria-label="CO2"]')!); });
    setInputValue(document.querySelector<HTMLInputElement>('#external-value')!, '5');
    setInputValue(document.querySelector<HTMLInputElement>('#external-calculated-by')!, '子会社 A');
    setTextarea('external-method', '電力使用量×係数');
    setSelect('external-evidence', fictionalEvidence[0].id);
    setSelect('external-confirmed-by', '5b1f0000-0000-4000-8000-000000000005');
    await act(async () => { click(button('保存する')); });
    await settle();
    expect(createSsbjExternalEmission).toHaveBeenCalledWith(
      expect.objectContaining({ id: report.id }),
      expect.objectContaining({
        scope: 1, gases: ['CO2'], value: '5', calculatedBy: '子会社 A', evidenceId: fictionalEvidence[0].id,
        period: { startDate: '2024-04-01', endDate: '2025-03-31' },
      }),
    );
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('OGT の採用値に含まれています');
  });

  it('保存されている確認者が今の選択肢に無ければ（退会など）、空にして選び直してもらう', async () => {
    vi.mocked(listSsbjMembers).mockResolvedValueOnce([{ id: '5b1f0000-0000-4000-8000-0000000000aa', name: '別の 人', role: 'logger' }]);
    const { container } = await open();
    await act(async () => { click(button('編集', container.querySelector<HTMLElement>('[data-testid="ssbj-external-emission"]')!)); });
    expect(document.querySelector<HTMLSelectElement>('#external-confirmed-by')!.value).toBe('');
    expect(document.querySelector<HTMLSelectElement>('#external-evidence')!.value).toBe(emission.evidenceId);
    await act(async () => { click(button('保存する')); });
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('確認者を選んでください');
  });

  it('削除が 0 件で止められたら、一覧から外さず、開き直しを案内する', async () => {
    vi.mocked(deleteSsbjExternalEmission).mockRejectedValueOnce(
      new Error('外部算定値を削除できませんでした（他の画面で削除された可能性があります）。画面を開き直してください'),
    );
    const { container } = await open();
    await act(async () => { click(button('削除', container.querySelector<HTMLElement>('[data-testid="ssbj-external-emission"]')!)); });
    await act(async () => { click(button('削除する')); });
    await settle();
    expect(deleteSsbjExternalEmission).toHaveBeenCalledWith(emission.id);
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('画面を開き直してください');
    expect(container.querySelectorAll('[data-testid="ssbj-external-emission"]')).toHaveLength(1);
  });

  it('入力担当か管理者でなければ、追加・編集・削除を出さない', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValueOnce('approver');
    const { container } = await open();
    expect([...container.querySelectorAll('button')].some(node => /外部算定値を追加|編集|削除/.test(node.textContent ?? ''))).toBe(false);
    expect(container.querySelector('[data-testid="ssbj-role-notice"]')).not.toBeNull();
  });

  it('根拠文書が無ければ追加を出さず、先に根拠文書を登録するよう案内する', async () => {
    vi.mocked(listSsbjEvidence).mockResolvedValue([]);
    vi.mocked(listSsbjExternalEmissions).mockResolvedValue([]);
    const { container } = await open();
    expect([...container.querySelectorAll('button')].some(node => node.textContent?.includes('外部算定値を追加'))).toBe(false);
    expect(container.textContent).toContain('外部算定値には根拠文書が必要です');
  });
});
