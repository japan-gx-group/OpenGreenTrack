// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import {
  fictionalSnapshot,
  fictionalVersionBeforeBasicInfoAdditions,
  LATER_ADDED_BASIC_INFO_KEYS,
} from '../../__fixtures__/fictionalReport';
import type { SsbjReportRecord } from '../../types';
import { SsbjReportBasicInfo } from '../SsbjReportBasicInfo';

let rendered: RenderResult | null = null;
afterEach(() => { rendered?.unmount(); rendered = null; });

const LATER_ADDED_LABELS = ['親会社名', '親会社との関係', '親会社の持分比率', '測定アプローチ', '業種（SICS）'];

const valueOf = (label: string) => {
  const term = Array.from(rendered?.container.querySelectorAll('dt') ?? []).find(item => item.textContent === label);
  return term?.nextElementSibling as HTMLElement | null | undefined;
};

describe('SsbjReportBasicInfo', () => {
  it('値のある任意項目はそのまま出す', () => {
    rendered = render(<SsbjReportBasicInfo report={fictionalSnapshot.report} />);
    expect(valueOf('親会社名')?.textContent).toBe('架空サンプルホールディングス株式会社');
    expect(valueOf('親会社との関係')?.textContent).toBe('連結子会社');
    expect(valueOf('親会社の持分比率')?.textContent).toBe('100%');
    expect(valueOf('測定アプローチ')?.textContent).toBe('経営支配力アプローチ');
    expect(valueOf('業種（SICS）')?.textContent).toContain('RT-IG');
    expect(valueOf('業種（SICS）')?.querySelector('a')).not.toBeNull();
  });

  it('値が null の任意項目は「未入力」と出す', () => {
    const report: SsbjReportRecord = {
      ...fictionalSnapshot.report,
      parentCompanyName: null,
      parentRelationship: null,
      ownershipPercentage: null,
      measurementApproach: null,
      industryCode: null,
    };
    rendered = render(<SsbjReportBasicInfo report={report} />);
    for (const label of LATER_ADDED_LABELS) {
      expect(valueOf(label)?.textContent).toBe('未入力');
      expect(valueOf(label)?.className).toContain('text-text-muted');
    }
  });

  it('任意項目を追加する前の保存版でキーが無くても、null と同じく「未入力」と出す', () => {
    const report = fictionalVersionBeforeBasicInfoAdditions.snapshot.report;
    for (const key of LATER_ADDED_BASIC_INFO_KEYS) expect(key in report).toBe(false);
    rendered = render(<SsbjReportBasicInfo report={report} />);
    for (const label of LATER_ADDED_LABELS) {
      expect(valueOf(label)?.textContent).toBe('未入力');
      expect(valueOf(label)?.className).toContain('text-text-muted');
    }
    expect(rendered.container.textContent).not.toContain('undefined');
  });
});
