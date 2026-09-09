// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import { KpiCard } from '../KpiCard';

// KPI カードの前年比ピルは「色で良し悪しを断定してよいのは年度終了後だけ」を守る。
// 分子＝表示年度の期中累計・分母＝前年度の通年実績のため、期中は分子が積み上がる途中にすぎず、
// 緑（削減）／赤（増加）を付けると実態より大きな削減・増加として読まれる。
// 増減率と向き（↑ / ↓）は事実なので出したまま、色だけ中立にして「（期中）」を添える。

const renderCard = (percent: number | null, fiscalYearEnded: boolean) =>
  render(
    <KpiCard
      id="total"
      label="総排出量"
      formattedValue="450"
      diff={{ percent, comparisonLabel: 'vs 2025年度' }}
      series={[1, 2, 3]}
      fiscalYearEnded={fiscalYearEnded}
    />,
  );

const pillOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.gt-pill')!;

describe('KpiCard の前年比ピル', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('年度終了後（評価が確定する）', () => {
    it('減っていれば success 色で出す', () => {
      const { container, unmount } = renderCard(-55, true);
      const pill = pillOf(container);
      expect(pill.className).toContain('gt-pill-good');
      expect(pill.textContent).toBe('↓55.0%');
      unmount();
    });

    it('増えていれば danger 色で出す', () => {
      const { container, unmount } = renderCard(12.5, true);
      const pill = pillOf(container);
      expect(pill.className).toContain('gt-pill-bad');
      expect(pill.textContent).toBe('↑12.5%');
      unmount();
    });
  });

  describe('期中（分子だけが積み上がる途中）', () => {
    it('減っていても success 色にせず「（期中）」を添えた中立色にする', () => {
      const { container, unmount } = renderCard(-55, false);
      const pill = pillOf(container);
      expect(pill.className).toContain('gt-pill-neutral');
      expect(pill.className).not.toContain('gt-pill-good');
      expect(pill.textContent).toBe('↓55.0%（期中）');
      unmount();
    });

    it('増えていても danger 色にせず「（期中）」を添えた中立色にする', () => {
      const { container, unmount } = renderCard(12.5, false);
      const pill = pillOf(container);
      expect(pill.className).toContain('gt-pill-neutral');
      expect(pill.className).not.toContain('gt-pill-bad');
      expect(pill.textContent).toBe('↑12.5%（期中）');
      unmount();
    });

    it('増減なしでも期中であることが分かるようにする', () => {
      const { container, unmount } = renderCard(0, false);
      expect(pillOf(container).textContent).toBe('—0.0%（期中）');
      unmount();
    });

    it('前年度のデータが無いときは「（期中）」を付けず、比較できない旨だけを出す', () => {
      const { container, unmount } = renderCard(null, false);
      const pill = pillOf(container);
      expect(pill.className).toContain('gt-pill-neutral');
      expect(pill.textContent).toBe('前年比データなし');
      unmount();
    });
  });
});
