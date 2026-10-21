// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import {
  FICTIONAL_DRAFT_REVIEW,
  fictionalGhgAdoption,
  fictionalOgtCandidates,
  fictionalReportBasicInfo,
  fictionalSnapshot,
  fictionalSupplierReferences,
} from '../../__fixtures__/fictionalReport';
import type { SsbjNarrative } from '../../types';

// 2 画面のエディタ: 右側のプレビューが、この画面の最新の入力（未保存の編集を含む）を重ねて描くこと、
// OGT の値（カンペ）を出すこと、採用後に OGT の値が変わっていれば上部で知らせること、右側を閉じられることを検証する。

vi.mock('../../services/previewService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/previewService')>()), getSsbjWorkingPreview: vi.fn(),
}));
vi.mock('../../services/ogtCandidateService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/ogtCandidateService')>()), getOgtCandidates: vi.fn(),
}));
vi.mock('../../services/ogtAdoptionService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/ogtAdoptionService')>()), getOgtAdoption: vi.fn(),
}));

import { getOgtAdoption } from '../../services/ogtAdoptionService';
import { getOgtCandidates } from '../../services/ogtCandidateService';
import { getSsbjWorkingPreview } from '../../services/previewService';
import { SsbjEditorLayout } from '../SsbjEditorLayout.client';

const report = { ...fictionalReportBasicInfo, title: '画面で直したレポート名', fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', draftRevision: 5, basicInfoRevision: 0, review: FICTIONAL_DRAFT_REVIEW };
const draft: SsbjNarrative = {
  itemId: 'governance.oversight_body',
  text: { disclosure: { state: 'answered', value: '入力中でまだ保存していない文章。' }, internalNote: null },
};

let rendered: RenderResult | null = null;
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };
const renderLayout = async (hasUnsavedDrafts = true) => {
  rendered = render(
    <SsbjEditorLayout report={report} overrides={{ narratives: [draft] }} hasUnsavedDrafts={hasUnsavedDrafts}>
      <p>左側の入力</p>
    </SsbjEditorLayout>,
  );
  await settle();
  return rendered;
};

beforeEach(() => {
  vi.mocked(getSsbjWorkingPreview).mockResolvedValue({ kind: 'working', draftRevision: 5, snapshot: fictionalSnapshot });
  vi.mocked(getOgtCandidates).mockResolvedValue({ candidates: fictionalOgtCandidates, suppliers: fictionalSupplierReferences });
  vi.mocked(getOgtAdoption).mockResolvedValue(fictionalGhgAdoption);
});
afterEach(() => { rendered?.unmount(); rendered = null; vi.clearAllMocks(); });

describe('SsbjEditorLayout', () => {
  it('プレビューに、この画面の最新の入力（未保存の文章・基本情報）を重ね、未保存を含むことを明示する', async () => {
    const { container } = await renderLayout();
    const preview = container.querySelector('[data-testid="ssbj-editor-preview"]')!;
    expect(preview.textContent).toContain('入力中でまだ保存していない文章。');
    expect(preview.textContent).not.toContain('当社では、取締役会が気候関連のリスク及び機会を監督している。');
    expect(preview.textContent).toContain('画面で直したレポート名');
    expect(container.querySelector('[data-testid="ssbj-editor-unsaved"]')).not.toBeNull();
    expect(container.textContent).toContain('左側の入力');
  });

  it('採用した値と OGT の最新の値が同じなら、上部の知らせは出さない', async () => {
    const { container } = await renderLayout(false);
    expect(container.querySelector('[data-testid="ssbj-ogt-change-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="ssbj-editor-unsaved"]')).toBeNull();
  });

  it('採用後に OGT の値が変わっていれば上部で知らせ、OGT の値のタブで最新の値と採用した値を並べる', async () => {
    const changed = fictionalOgtCandidates.map(candidate =>
      candidate.scope === 1 ? { ...candidate, value: { state: 'answered' as const, value: '900.000' } } : candidate);
    vi.mocked(getOgtCandidates).mockResolvedValue({ candidates: changed, suppliers: fictionalSupplierReferences });
    const { container } = await renderLayout();
    expect(container.querySelector('[data-testid="ssbj-ogt-change-banner"]')?.textContent).toContain('Scope 1');

    const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(element => element.textContent === 'OGT の値')!;
    act(() => { tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
    const reference = container.querySelector('[data-testid="ssbj-ogt-reference"]')!;
    const scope1 = Array.from(reference.querySelectorAll('tbody tr')).find(row => row.textContent?.startsWith('Scope 1'))!;
    expect(scope1.textContent).toContain('900.000 t-CO2e');
    expect(scope1.textContent).toContain('812.345 t-CO2e');
  });

  it('右側を閉じて、入力に広く使える', async () => {
    const { container } = await renderLayout();
    const toggle = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('閉じる'))!;
    click(toggle);
    expect(container.querySelector('aside')).toBeNull();
    expect(container.textContent).toContain('左側の入力');
  });
});
