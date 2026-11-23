// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { fictionalGhgAdoption, fictionalReductionTarget } from '../../__fixtures__/fictionalReport';
import { SsbjPreviewReductionTarget } from '../SsbjPreviewReductionTarget';

let rendered: RenderResult | null = null;
afterEach(() => { rendered?.unmount(); rendered = null; });
const text = () => rendered?.container.textContent ?? '';

describe('SsbjPreviewReductionTarget', () => {
  it('基準年度・レポートの年度の目標と実績・差・年度ごとの削減率を、採用した値のまま出す', () => {
    rendered = render(<SsbjPreviewReductionTarget ghg={fictionalGhgAdoption} />);
    expect(text()).toContain('2022年度（2022-04-01 〜 2023-03-31）');
    expect(text()).toContain('1,000 t-CO2e');
    expect(text()).toContain('基準年度比 12.5% 削減');
    expect(text()).toContain('875 t-CO2e');
    expect(text()).toContain('900.25 t-CO2e');
    expect(text()).toContain('目標を 25.25 t-CO2e 上回る');
    expect(text()).toContain('2025 年度20%800 t-CO2e');
    expect(text()).not.toContain('期中の累計');
  });

  it('レポートの年度に削減率が無ければ「目標未設定」にし、0% にしない。基準年度が期中だったら注記する', () => {
    if (fictionalReductionTarget.status !== 'set') throw new Error('fixture');
    rendered = render(<SsbjPreviewReductionTarget ghg={{
      ...fictionalGhgAdoption,
      reductionTarget: {
        ...fictionalReductionTarget,
        baseYearEnded: false,
        reportYear: { ...fictionalReductionTarget.reportYear, reductionPercent: { state: 'unanswered' }, targetEmissions: { state: 'unanswered' } },
      },
    }} />);
    expect(text()).toContain('目標未設定');
    expect(text()).not.toContain('0% 削減');
    expect(text()).toContain('期中の累計');
  });

  it.each([
    ['この版に GHG の項目が無い', undefined, 'この版には削減目標の項目が含まれていません'],
    ['OGT の値を採用していない', null, 'まだ採用されていません'],
    ['OGT に目標が無い', { ...fictionalGhgAdoption, reductionTarget: { status: 'not_set' as const } }, '削減目標が登録されていませんでした'],
  ])('%s', (_label, ghg, expected) => {
    rendered = render(<SsbjPreviewReductionTarget ghg={ghg} />);
    expect(text()).toContain(expected);
  });

  it('削減目標を一緒に採用する前の採用（キーが無い）は、採用し直せば入ることを案内する', () => {
    const { reductionTarget: _omitted, ...before } = fictionalGhgAdoption;
    void _omitted;
    rendered = render(<SsbjPreviewReductionTarget ghg={before} />);
    expect(text()).toContain('採用し直すと、削減目標も入ります');
  });
});
