// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { FICTIONAL_REPORT_ID, fictionalSnapshot } from '../../__fixtures__/fictionalReport';
import { ssbjOverallProgress, ssbjReportProgress } from '../../utils/reportProgress';
import { SSBJ_NARRATIVE_ITEMS, SSBJ_REQUIREMENTS } from '../../utils/requirementMaster';
import { SsbjReportContentsNav } from '../SsbjReportContentsNav';

// 詳細画面の「レポートの内容」: 全体の進み具合・次にやること（該当の画面へのリンク）と、タブがあるときに説明の一覧を畳むことを検証する。

let rendered: RenderResult | null = null;
afterEach(() => { rendered?.unmount(); rendered = null; });

const REQUIREMENT_ITEMS = SSBJ_NARRATIVE_ITEMS.filter(item => item.kind === 'requirement').length;
const progress = ssbjReportProgress(fictionalSnapshot.sections);
const base = `/ssbj/${FICTIONAL_REPORT_ID}`;

describe('SsbjReportContentsNav', () => {
  it('全体の進み具合と、文章・判断・根拠の数を出す', () => {
    rendered = render(<SsbjReportContentsNav reportId={FICTIONAL_REPORT_ID} progress={{ progress, errorMessage: '' }} withTabs />);
    const summary = rendered.container.querySelector('[data-testid="ssbj-report-progress"]');
    expect(summary?.textContent).toContain(`全体の進み具合${Math.round(ssbjOverallProgress(progress).ratio * 100)} %`);
    expect(summary?.textContent).toContain(`文章2 / ${REQUIREMENT_ITEMS}`);
    expect(summary?.textContent).toContain(`判断3 / ${SSBJ_REQUIREMENTS.length}`);
    expect(summary?.textContent).toContain('根拠1 / 2');
  });

  it('次にやることを、該当の画面へのリンクで出す', () => {
    rendered = render(<SsbjReportContentsNav reportId={FICTIONAL_REPORT_ID} progress={{ progress, errorMessage: '' }} withTabs />);
    const links = Array.from(rendered.container.querySelectorAll('[data-testid="ssbj-next-steps"] a'));
    expect(links.map(link => [link.getAttribute('href'), link.querySelector('span span')?.textContent])).toEqual([
      [`${base}/narratives`, `未入力の文章 ${REQUIREMENT_ITEMS - 3} 件`],
      [`${base}/narratives`, '未確認の文章 1 件'],
      [`${base}/judgements`, `未判断の要求 ${SSBJ_REQUIREMENTS.length - 5} 件`],
      [`${base}/judgements`, '要確認の判断 2 件'],
      [`${base}/evidence`, '根拠の無い入力済みの文章 1 件'],
    ]);
  });

  it('タブがあるときは、各画面の説明の一覧を畳んで出す（タブが無ければ、そのまま出す）', () => {
    rendered = render(<SsbjReportContentsNav reportId={FICTIONAL_REPORT_ID} withTabs />);
    const details = rendered.container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('各画面でできること');
    expect(details?.querySelectorAll('a')).toHaveLength(9);
    rendered.unmount();

    rendered = render(<SsbjReportContentsNav reportId={FICTIONAL_REPORT_ID} />);
    expect(rendered.container.querySelector('details')).toBeNull();
    expect(rendered.container.querySelectorAll('a')).toHaveLength(9);
  });

  it('閲覧者には進み具合を出さず、閲覧できる画面だけを出す', () => {
    rendered = render(
      <SsbjReportContentsNav reportId={FICTIONAL_REPORT_ID} workingAccess={false} progress={{ progress, errorMessage: '' }} />,
    );
    expect(rendered.container.querySelector('[data-testid="ssbj-report-progress"]')).toBeNull();
    expect(Array.from(rendered.container.querySelectorAll('a')).map(link => link.getAttribute('href')))
      .toEqual([`${base}/preview`, `${base}/versions`]);
  });

  it('数えている間・数えられなかったときは、その旨を出す', () => {
    rendered = render(<SsbjReportContentsNav reportId={FICTIONAL_REPORT_ID} progress={{ progress: null, errorMessage: '' }} />);
    expect(rendered.container.textContent).toContain('進み具合を数えています...');
    rendered.unmount();
    rendered = render(
      <SsbjReportContentsNav reportId={FICTIONAL_REPORT_ID} progress={{ progress: null, errorMessage: '取得に失敗しました' }} />,
    );
    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('取得に失敗しました');
  });
});
