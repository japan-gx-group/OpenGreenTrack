// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, keyDown, render, type RenderResult } from '@/lib/testing/render';
import { fictionalNarratives, fictionalVersion } from '../../__fixtures__/fictionalReport';
import type { SsbjStoredVersion, SsbjVersionSummary } from '../../services/versionExportService';

vi.mock('../../services/auditLogService', () => ({ getLatestSsbjReviewRequestAt: vi.fn() }));
vi.mock('../../services/versionExportService', () => ({ getSsbjCsvVersion: vi.fn() }));

import { getLatestSsbjReviewRequestAt } from '../../services/auditLogService';
import { getSsbjCsvVersion } from '../../services/versionExportService';
import { SsbjVersionCompare } from '../SsbjVersionCompare.client';

// jsdom には scrollIntoView が無い（Radix の Select が開いたときに選択中の項目へ寄せるのに使う）。
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

let rendered: RenderResult | null = null;
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.clearAllMocks();
});

const OVERSIGHT_INTERNAL_NOTE = '親会社との関係は確認済み（架空）。';

/** 版 1 → 版 2 で監督する機関の文章を書き足し、内部メモも変えた。版 3 は版 2 と同じ内容。 */
const version = (versionNumber: number, createdAt: string, changed: boolean): SsbjStoredVersion => ({
  id: `5b1f0000-0000-4000-8000-00000000010${versionNumber}`,
  reportId: fictionalVersion.reportId,
  versionNumber,
  createdAt,
  snapshot: {
    ...fictionalVersion.snapshot,
    sections: {
      ...fictionalVersion.snapshot.sections,
      narratives: fictionalNarratives.map(narrative => changed && narrative.itemId === 'governance.oversight_body'
        ? {
          ...narrative,
          text: {
            disclosure: { state: 'answered', value: '当社では、取締役会が年2回、気候関連のリスク及び機会を監督している。' },
            internalNote: OVERSIGHT_INTERNAL_NOTE,
          },
        }
        : narrative),
    },
  },
});

const stored = [
  version(1, '2025-11-10T02:00:00.000Z', false),
  version(2, '2025-11-15T08:30:00.000Z', true),
  version(3, '2025-11-17T00:12:00.000Z', true),
];
const summaries: SsbjVersionSummary[] = [...stored].reverse().map(item => ({
  id: item.id,
  versionNumber: item.versionNumber,
  createdAt: item.createdAt,
  note: null,
  sourceVersionId: null,
  createdByUserId: null,
  creatorName: '入力担当',
}));

const text = () => rendered?.container.textContent ?? '';
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const buttonWith = (label: string) => {
  const button = Array.from(rendered!.container.querySelectorAll('button')).find(item => item.textContent?.includes(label));
  if (!button) throw new Error(`ボタン「${label}」がありません`);
  return button;
};

/** 「前の版」「後の版」の選択（Radix の Select）をキーボードで開き、版番号の項目を選ぶ。 */
const choose = async (side: 'fromId' | 'toId', versionNumber: number) => {
  const trigger = rendered!.container.querySelector<HTMLElement>(`#ssbj-compare-${side}`);
  if (!trigger) throw new Error(`選択 ${side} がありません`);
  keyDown(trigger, 'Enter');
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    .find(item => item.textContent?.startsWith(`版 ${versionNumber}（`));
  if (!option) throw new Error(`版 ${versionNumber} の選択肢がありません`);
  keyDown(option, 'Enter');
  await flush();
  await flush();
};

const open = async (requestedAt: string | null) => {
  vi.mocked(getLatestSsbjReviewRequestAt).mockResolvedValue(requestedAt);
  vi.mocked(getSsbjCsvVersion).mockImplementation(async (_reportId, versionId) => {
    const found = stored.find(item => item.id === versionId);
    if (!found) throw new Error('保存版が見つかりません');
    return found;
  });
  rendered = render(<SsbjVersionCompare reportId={fictionalVersion.reportId} versions={summaries} />);
  // 開くまでは何も読まない。
  expect(getLatestSsbjReviewRequestAt).not.toHaveBeenCalled();
  click(buttonWith('版を比べる'));
  await flush();
  await flush();
};

describe('SsbjVersionCompare', () => {
  it('既定は最新のレビュー依頼より前の最後の版 → 最新の版で、変わった項目だけを文字の差分で並べる', async () => {
    await open('2025-11-15T08:40:00.000Z');
    expect(getSsbjCsvVersion).toHaveBeenCalledWith(fictionalVersion.reportId, stored[1].id);
    expect(getSsbjCsvVersion).toHaveBeenCalledWith(fictionalVersion.reportId, stored[2].id);
    expect(rendered!.container.querySelector('[data-testid="ssbj-compare-basis"]')?.textContent).toContain('最新のレビュー依頼');
    // 版 2 と版 3 は同じ内容。
    expect(text()).toContain('版 2 → 版 3 ・ 変更 0 項目');
    expect(text()).toContain('変更はありません。');
  });

  it('依頼の時点が分からなければ 1 つ前の版 → 最新の版', async () => {
    await open(null);
    expect(rendered!.container.querySelector('[data-testid="ssbj-compare-basis"]')?.textContent).toContain('1 つ前の版');
    expect(text()).toContain('版 2 → 版 3');
  });

  it('文章の追加は色付きで、項目の名前は要求項目マスターの名前。「見た」は画面の中で数え、内部メモは選んだときだけ出す', async () => {
    await open('2025-11-12T00:00:00.000Z');
    expect(text()).toContain('版 1 → 版 3 ・ 変更 1 項目');
    const items = rendered!.container.querySelectorAll('[data-testid="ssbj-version-change"]');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('監督する機関・責任者');
    expect(items[0].querySelector('ins')?.textContent).toBe('年2回、');
    expect(text()).not.toContain('内部メモ（開示しない）');
    expect(text()).toContain('（見た 0 / 1）');

    click(items[0].querySelector('button[role="checkbox"]')!);
    expect(text()).toContain('（見た 1 / 1）');

    const internalToggle = rendered!.container.querySelector('#ssbj-compare-internal-' + fictionalVersion.reportId);
    click(internalToggle!);
    expect(text()).toContain('内部メモ（開示しない）');
    expect(rendered!.container.querySelectorAll('[data-testid="ssbj-version-text-diff"] del').length).toBeGreaterThan(0);
  });

  it('前の版に新しい版を選ぶと、版番号の小さい順に入れ替えて比べ、その旨を出す', async () => {
    await open(null);
    await choose('fromId', 3);
    // 前の版 3・後の版 3 は同じ版。読まずに「同じ版です」と出す。
    expect(text()).toContain('同じ版です。');
    expect(getSsbjCsvVersion).toHaveBeenCalledTimes(2);

    await choose('toId', 1);
    expect(rendered!.container.querySelector('[data-testid="ssbj-compare-swapped"]')).not.toBeNull();
    expect(text()).toContain('版 1 → 版 3 ・ 変更 1 項目');
    expect(rendered!.container.querySelector('#ssbj-compare-fromId')?.textContent).toContain('版 1（');
    expect(rendered!.container.querySelector('#ssbj-compare-toId')?.textContent).toContain('版 3（');
    expect(rendered!.container.querySelector('[data-testid="ssbj-version-change"] ins')?.textContent).toBe('年2回、');
  });

  it('「版を比べる」を開くたびに、最新のレビュー依頼を読み直す', async () => {
    await open(null);
    expect(getLatestSsbjReviewRequestAt).toHaveBeenCalledTimes(1);
    click(buttonWith('比べるのをやめる'));
    vi.mocked(getLatestSsbjReviewRequestAt).mockResolvedValue('2025-11-12T00:00:00.000Z');
    click(buttonWith('版を比べる'));
    await flush();
    await flush();
    expect(getLatestSsbjReviewRequestAt).toHaveBeenCalledTimes(2);
    expect(text()).toContain('版 1 → 版 3');
  });
});
