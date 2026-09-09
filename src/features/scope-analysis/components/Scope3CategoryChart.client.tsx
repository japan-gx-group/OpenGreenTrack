'use client';

import { useState } from 'react';
import type { Scope3CategoryItem } from '../services/scopeAnalysisService';

// ランク（排出量降順）ごとの配色。デザイン正（GreenTrack ダッシュボード）の
// ドーナツ配色に対応するデザイントークンを順に割り当てる。
// 上位6色は正のドーナツと一致（primary→success→teal→sage→terracotta→gray）。
const RANK_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-chart-teal)',
  'var(--color-scope-2)',
  'var(--color-scope-3)',
  'var(--color-chart-gray-light)',
  'var(--color-chart-yellow)',
  'var(--color-info)',
  'var(--color-chart-gray)',
];

const RADIUS = 70;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 439.82

// 合計値は service の formatNumber と同じ書式（ja-JP・小数第3位まで）で揃える。
const numberFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
const pad2 = (value: number) => String(value).padStart(2, '0');
const colorAt = (index: number) => RANK_COLORS[index % RANK_COLORS.length];

interface Scope3CategoryChartProps {
  // 排出量の降順でソート済みのカテゴリ一覧
  categories: Scope3CategoryItem[];
}

export const Scope3CategoryChart = ({ categories }: Scope3CategoryChartProps) => {
  // ドーナツと凡例で共有するホバー中カテゴリの index。
  const [hovered, setHovered] = useState<number | null>(null);

  const total = categories.reduce((sum, category) => sum + category.emissions, 0);
  const maxEmissions = categories.reduce((max, category) => Math.max(max, category.emissions), 0);

  // 各セグメントの dash / offset を構成比から算出する。
  // dash = 構成比 × 円周、offset = -(それまでの累積構成比) × 円周。
  const fractions = categories.map((category) => (total > 0 ? category.emissions / total : 0));
  const segments = fractions.map((fraction, index) => {
    const fractionBefore = fractions.slice(0, index).reduce((sum, value) => sum + value, 0);
    return {
      dash: fraction * CIRCUMFERENCE,
      offset: -fractionBefore * CIRCUMFERENCE,
    };
  });

  const active = hovered !== null ? categories[hovered] : null;
  const center = active
    ? {
        // 中央ラベルは「番号（全角スペース）カテゴリ名」。全角スペースはデザイン正に合わせる。
        label: `${pad2(active.id)}\u3000${active.displayName ?? active.name}`,
        value: active.value,
        sub: `${active.percentage} ・ t-CO₂e`,
        color: colorAt(hovered!),
        labelColor: colorAt(hovered!),
      }
    : {
        label: 'Scope 3 合計',
        value: numberFormatter.format(total),
        sub: 't-CO₂e',
        color: 'var(--color-text-main)',
        labelColor: 'var(--color-text-label)',
      };

  return (
    <div className="grid grid-cols-1 items-center gap-9 lg:grid-cols-[280px_1fr]">
      {/* ドーナツ */}
      <div className="relative mx-auto h-[280px] w-[280px]">
        <svg width="280" height="280" viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="var(--color-chart-track)" strokeWidth={30} />
          {segments.map((segment, index) => {
            const dimmed = hovered !== null && hovered !== index;
            return (
              <circle
                key={categories[index].id}
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                strokeLinecap="butt"
                stroke={colorAt(index)}
                strokeWidth={hovered === index ? 40 : 30}
                strokeDasharray={`${segment.dash} ${CIRCUMFERENCE}`}
                strokeDashoffset={segment.offset}
                opacity={dimmed ? 0.32 : 1}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer', transition: 'stroke-width .15s ease, opacity .15s ease' }}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <span
            className="flex min-h-[30px] max-w-[120px] items-center text-[11.5px] font-medium leading-snug"
            style={{ color: center.labelColor }}
          >
            {center.label}
          </span>
          <span className="font-serif text-[34px] font-semibold leading-none" style={{ color: center.color }}>
            {center.value}
          </span>
          <span className="text-[11.5px] text-text-label">{center.sub}</span>
        </div>
      </div>

      {/* ランキング凡例 */}
      <div className="flex min-w-0 flex-col">
        <div className="grid grid-cols-[26px_1fr_92px_132px] items-center gap-3.5 border-b border-border-light px-0.5 pb-2.5 text-[10.5px] uppercase tracking-[0.06em] text-text-label">
          <span />
          <span>カテゴリ</span>
          <span className="text-right">t-CO₂e</span>
          <span className="text-right">構成比</span>
        </div>
        {categories.map((category, index) => {
          const dimmed = hovered !== null && hovered !== index;
          const barPct = maxEmissions > 0 ? (category.emissions / maxEmissions) * 100 : 0;
          return (
            <div
              key={category.id}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              className="-mx-1.5 grid cursor-pointer grid-cols-[26px_1fr_92px_132px] items-center gap-3.5 rounded-lg border-b border-border-light px-2 py-[11px] transition-colors"
              style={{ background: hovered === index ? 'var(--color-bg-subtle)' : 'transparent' }}
            >
              <span
                className="h-3 w-3 rounded-[3px]"
                style={{ background: colorAt(index), opacity: dimmed ? 0.32 : 1 }}
              />
              <span className="min-w-0 truncate text-[13px] text-text-heading">
                <span className="mr-2 font-serif font-semibold text-text-label">{pad2(category.id)}</span>
                {category.displayName ?? category.name}
              </span>
              <span className="text-right font-serif text-[15px] font-semibold text-text-heading">
                {category.value}
              </span>
              <div className="flex items-center gap-2.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--color-chart-track)' }}>
                  <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: colorAt(index) }} />
                </div>
                <span className="w-11 text-right text-[12.5px] font-semibold text-text-heading">
                  {category.percentage}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
