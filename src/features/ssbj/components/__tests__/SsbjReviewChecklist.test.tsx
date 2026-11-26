// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { FICTIONAL_REPORT_ID } from '../../__fixtures__/fictionalReport';
import type { SsbjChecklistRow } from '../../utils/reviewChecklist';
import { SsbjReviewChecklist } from '../SsbjReviewChecklist';

// 依頼の前の点検表の表示: 行ごとの ✓／注意／要確認と件数、済んでいない行だけの「開く」、数えている間・数えられないときを検証する。

let rendered: RenderResult | null = null;
afterEach(() => { rendered?.unmount(); rendered = null; });

const ROWS: SsbjChecklistRow[] = [
  { key: 'narratives', status: 'warning', label: '文章', detail: '未入力 10・未確認 2', count: 12, path: 'narratives' },
  { key: 'ogt', status: 'ok', label: 'OGT の値', detail: '採用した値は最新', count: 0, path: 'ghg' },
  { key: 'conflict-not_applicable_with_text', status: 'review', label: '「非該当」なのに文章がある', detail: '比較情報',
    count: 1, path: 'judgements' },
];

describe('SsbjReviewChecklist', () => {
  it('行ごとに状態と件数を出し、済んでいない行だけに該当の画面へのリンクを出す', () => {
    rendered = render(<SsbjReviewChecklist reportId={FICTIONAL_REPORT_ID} rows={ROWS} />);
    const { container } = rendered;
    expect(container.querySelector('h3')?.textContent).toBe('依頼の前の点検（3 項目中 2 項目に注意）');
    const badges = Array.from(container.querySelectorAll('[data-slot="badge"]')).map(badge => badge.textContent);
    expect(badges).toEqual(['注意12', '✓', '要確認1']);
    expect(Array.from(container.querySelectorAll('a')).map(link => link.getAttribute('href'))).toEqual([
      `/ssbj/${FICTIONAL_REPORT_ID}/narratives`, `/ssbj/${FICTIONAL_REPORT_ID}/judgements`,
    ]);
    expect(container.textContent).toContain('注意や要確認があっても、レビューは依頼できます');
  });

  it('確認中の行は注意に数えず、リンクも出さない', () => {
    const checking: SsbjChecklistRow = { key: 'ogt', status: 'checking', label: 'OGT の値', detail: '最新の値と比べています',
      count: null, path: 'ghg' };
    rendered = render(<SsbjReviewChecklist reportId={FICTIONAL_REPORT_ID} rows={[ROWS[0], checking]} />);
    expect(rendered.container.querySelector('h3')?.textContent).toBe('依頼の前の点検（2 項目中 1 項目に注意）');
    expect(Array.from(rendered.container.querySelectorAll('[data-slot="badge"]')).map(badge => badge.textContent))
      .toEqual(['注意12', '確認中']);
    expect(rendered.container.querySelectorAll('a')).toHaveLength(1);
  });

  it('すべて済んでいれば、見出しに「すべて ✓」と出す', () => {
    rendered = render(<SsbjReviewChecklist reportId={FICTIONAL_REPORT_ID} rows={[ROWS[1]]} />);
    expect(rendered.container.querySelector('h3')?.textContent).toBe('依頼の前の点検（1 項目中 すべて ✓）');
  });

  it('数えている間と、作業中の内容を読めなかったときは、その旨を出す', () => {
    rendered = render(<SsbjReviewChecklist reportId={FICTIONAL_REPORT_ID} rows={null} />);
    expect(rendered.container.textContent).toBe('依頼の前の点検をしています...');
    rendered.unmount();
    rendered = render(<SsbjReviewChecklist reportId={FICTIONAL_REPORT_ID} rows={null} errorMessage="取得に失敗しました" />);
    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('取得に失敗しました');
  });
});
