// ダッシュボード上段の KPI カード（総排出量 / Scope 1 / 2 / 3）。
// 「ラベル＋大きな値＋前年比ピル＋スパークライン」の1枚を4枚並べる（デザイン正）。

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Sparkline } from './Sparkline.client';

export type KpiDiff = {
  /** 前年比（%）。前年データが無い場合は null */
  percent: number | null;
  /** ピル右の補足（例: "vs 2025年度"）。空文字なら出さない */
  comparisonLabel: string;
};

type KpiCardProps = {
  id: string;
  label: string;
  /** ラベル左の系列ドット。総排出量など系列を持たないカードでは省略 */
  dotColor?: string;
  formattedValue: string;
  diff: KpiDiff | null;
  /** 前年比の代わりに出す注記（拠点絞り込み中の Scope 3 など） */
  note?: { pill: string; description: string };
  /** スパークラインの元系列（月別） */
  series: number[];
  /**
   * 表示中の年度が終了済みか。前年比の評価色（増減の良し悪し）を年度終了後に限るために使う。
   * 年度行の期間が取れない場合は false（＝断定しない）を渡す。
   */
  fiscalYearEnded: boolean;
  /** 更新中に数値を淡くする */
  isStale?: boolean;
  /** 値の右に出す単位 */
  unit?: ReactNode;
};

const formatPercent = (percent: number) => `${Math.abs(percent).toFixed(1)}%`;

export const KpiCard = ({
  id,
  label,
  dotColor,
  formattedValue,
  diff,
  note,
  series,
  fiscalYearEnded,
  isStale = false,
  unit = 't-CO2e',
}: KpiCardProps) => {
  // 排出量は「減っていれば良い」ため、マイナスをグリーン・プラスをダンジャーに割り当てる。
  //
  // ただし色による良し悪しの断定は年度終了後に限る。分子＝表示年度の期中累計・分母＝前年度の
  // 通年実績の比較のため、年度が終わるまでは実態より大きな「削減」に見える（期首・未入力なら
  // 「↓100.0%」）。期中は増減率そのものは出しつつ、中立色にして「（期中）」を添え、途中経過だと示す。
  // 削減目標カードの基準年度比・達成状況ピルと同じ整理。
  const pill = (() => {
    if (note) return { className: 'gt-pill-neutral', text: note.pill, arrow: '' };
    if (!diff || diff.percent === null) {
      return { className: 'gt-pill-neutral', text: '前年比データなし', arrow: '' };
    }
    const suffix = fiscalYearEnded ? '' : '（期中）';
    if (diff.percent < -0.05) {
      return {
        className: fiscalYearEnded ? 'gt-pill-good' : 'gt-pill-neutral',
        text: `${formatPercent(diff.percent)}${suffix}`,
        arrow: '↓',
      };
    }
    if (diff.percent > 0.05) {
      return {
        className: fiscalYearEnded ? 'gt-pill-bad' : 'gt-pill-neutral',
        text: `${formatPercent(diff.percent)}${suffix}`,
        arrow: '↑',
      };
    }
    return { className: 'gt-pill-neutral', text: `0.0%${suffix}`, arrow: '—' };
  })();

  const caption = note ? note.description : (diff?.percent !== null && diff?.comparisonLabel) || '';
  const sparkColor = dotColor ?? 'var(--color-primary)';

  return (
    <div
      className="gt-card"
      style={{ position: 'relative', overflow: 'hidden', padding: '19px 22px 44px' }}
    >
      <div className="flex items-center" style={{ gap: '8px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
        {dotColor && (
          <span
            className="rounded-full"
            style={{
              width: '8px',
              height: '8px',
              flex: 'none',
              backgroundColor: dotColor,
            }}
          />
        )}
        <span className="truncate">{label}</span>
      </div>

      <div
        className="flex items-baseline"
        style={{ gap: '7px', marginTop: '9px', opacity: isStale ? 0.45 : 1, transition: 'opacity .25s' }}
      >
        <span
          data-testid={id === 'total' ? 'dashboard-total-emissions' : undefined}
          style={{
            fontSize: '36px',
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '-0.025em',
            color: 'var(--color-text-heading)',
            whiteSpace: 'nowrap',
          }}
        >
          {formattedValue}
        </span>
        <span style={{ fontSize: '12.5px', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap' }}>{unit}</span>
      </div>

      <div
        className="flex items-center"
        style={{ gap: '9px', marginTop: '13px', opacity: isStale ? 0.45 : 1, transition: 'opacity .25s' }}
      >
        <span className={clsx('gt-pill', pill.className)}>
          {pill.arrow && <span aria-hidden="true">{pill.arrow}</span>}
          {pill.text}
        </span>
        {caption && <span style={{ fontSize: '12px', color: 'var(--color-text-subtle)' }}>{caption}</span>}
      </div>

      <div style={{ opacity: isStale ? 0.45 : 1, transition: 'opacity .25s' }}>
        <Sparkline values={series} color={sparkColor} gradientId={`spark-${id}`} />
      </div>
    </div>
  );
};
