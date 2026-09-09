'use client';

// ダッシュボード下段の「排出量上位拠点」。行クリックでその拠点に絞り込む（デザイン正）。
//
// 行の操作は「ダッシュボード内の拠点絞り込み」であり、拠点詳細ページへの遷移ではない。
// そのため行末のアイコンは他画面で遷移を意味する「↗」ではなく絞り込みを表すアイコンにし、
// <tr onClick> だけではキーボード・スクリーンリーダーから辿れないため、
// 拠点名セルに実ボタンを置いて Tab → Enter / Space でも同じ絞り込みができるようにする。

import { useId } from 'react';
import { Building2, ListFilter } from 'lucide-react';
import clsx from 'clsx';
import {
  getLocationTypeLabel,
  getRegionLabel,
  type LocationType,
  type Region,
} from '@/features/locations/types';
import type { DashboardTopLocationDetail } from '../services/dashboardService';

const formatNumber = (value: number) =>
  new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 }).format(value);

// 前年比の評価色（増減の良し悪し）は年度終了後に限る。分子＝表示年度の期中累計・分母＝前年度の
// 通年実績の比較のため、年度が終わるまでは実態より大きな「削減」に見える。期中は増減率そのものは
// 出しつつ中立色にして「（期中）」を添え、途中経過だと示す（KPI カード・削減目標カードと同じ整理）。
const DiffPill = ({ percent, fiscalYearEnded }: { percent: number | null; fiscalYearEnded: boolean }) => {
  if (percent === null) {
    return <span className="gt-pill gt-pill-sm gt-pill-neutral">前年比データなし</span>;
  }
  const suffix = fiscalYearEnded ? '' : '（期中）';
  if (percent < -0.05) {
    return (
      <span className={clsx('gt-pill gt-pill-sm', fiscalYearEnded ? 'gt-pill-good' : 'gt-pill-neutral')}>
        <span aria-hidden="true">↓</span>
        {Math.abs(percent).toFixed(1)}%{suffix}
      </span>
    );
  }
  if (percent > 0.05) {
    return (
      <span className={clsx('gt-pill gt-pill-sm', fiscalYearEnded ? 'gt-pill-bad' : 'gt-pill-neutral')}>
        <span aria-hidden="true">↑</span>
        {percent.toFixed(1)}%{suffix}
      </span>
    );
  }
  return <span className="gt-pill gt-pill-sm gt-pill-neutral">0.0%{suffix}</span>;
};

export const TopLocationsTable = ({
  rows,
  fiscalYearLabel,
  fiscalYearEnded,
  selectedLocationId,
  onSelectLocation,
  isStale = false,
  emptyMessage,
}: {
  rows: DashboardTopLocationDetail[];
  fiscalYearLabel: string;
  /** 表示中の年度が終了済みか。前年比の評価色を年度終了後に限るために使う（DiffPill 参照） */
  fiscalYearEnded: boolean;
  selectedLocationId: string | null;
  onSelectLocation: (locationId: string | null) => void;
  isStale?: boolean;
  emptyMessage: string;
}) => {
  // 行内ボタンの説明として案内文を結び付け、スクリーンリーダーが
  // 「何を切り替えるボタンか」を読み上げられるようにする。
  const hintId = useId();

  return (
    <section className="gt-card gt-card-table">
      <div className="gt-card-head">
        <div>
          <h2 className="gt-card-title">排出量上位拠点</h2>
          <p className="gt-card-sub">{fiscalYearLabel}・Scope 1・2 の合計（t-CO2e）</p>
        </div>
        <span id={hintId} style={{ fontSize: '12.5px', color: 'var(--color-text-subtle)', flex: 'none' }}>
          行を選ぶとその拠点で絞り込みます
        </span>
      </div>

      <div style={{ overflowX: 'auto', marginTop: '6px' }}>
        <table className="gt-table" style={{ minWidth: '720px' }}>
          <thead>
            <tr>
              <th>拠点名</th>
              <th style={{ width: '160px' }}>地域 / 種別</th>
              <th className="gt-num" style={{ width: '130px' }}>Scope 1</th>
              <th className="gt-num" style={{ width: '130px' }}>Scope 2</th>
              <th className="gt-num" style={{ width: '150px' }}>{fiscalYearLabel} 排出量</th>
              <th className="gt-num" style={{ width: '160px' }}>前年比</th>
              <th style={{ width: '30px' }} />
            </tr>
          </thead>
          <tbody style={{ opacity: isStale ? 0.45 : 1, transition: 'opacity .25s' }}>
            {rows.length === 0 && (
              <tr>
                <td className="gt-table-empty" colSpan={7}>
                  {emptyMessage}
                </td>
              </tr>
            )}
            {rows.map(row => {
              const isSelected = row.locationId === selectedLocationId;
              const toggle = () => onSelectLocation(isSelected ? null : row.locationId);
              return (
                /* マウス利用者向けに行全体をクリック対象として残しつつ、
                   キーボード・スクリーンリーダー向けの実ボタンを拠点名セルに置く。
                   ボタンの click は行の onClick と二重に発火しないよう stopPropagation で止める。 */
                <tr
                  key={row.locationId}
                  className="gt-row-link"
                  onClick={toggle}
                  style={{ backgroundColor: isSelected ? 'var(--color-primary-light)' : undefined }}
                >
                  <td style={{ fontWeight: isSelected ? 600 : 400 }}>
                    <button
                      type="button"
                      className="gt-row-toggle inline-flex items-center"
                      style={{ gap: '11px' }}
                      aria-pressed={isSelected}
                      aria-describedby={hintId}
                      onClick={event => {
                        event.stopPropagation();
                        toggle();
                      }}
                    >
                      <span
                        className="inline-flex items-center justify-center"
                        style={{
                          width: '26px',
                          height: '26px',
                          flex: 'none',
                          borderRadius: '8px',
                          backgroundColor: 'var(--color-bg-subtle)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        <Building2 size={14} strokeWidth={1.8} />
                      </span>
                      {row.name}
                    </button>
                  </td>
                  <td style={{ fontSize: '13px', color: 'var(--color-text-body)' }}>
                    {row.region ? getRegionLabel(row.region as Region) : '—'}
                    <span style={{ color: 'var(--color-text-subtle)' }}>
                      {' / '}
                      {row.type ? getLocationTypeLabel(row.type as LocationType) : '—'}
                    </span>
                  </td>
                  <td className="gt-num" style={{ color: 'var(--color-text-body)' }}>{formatNumber(row.scope1)}</td>
                  <td className="gt-num" style={{ color: 'var(--color-text-body)' }}>{formatNumber(row.scope2)}</td>
                  <td className={clsx('gt-num')} style={{ fontSize: '14px', fontWeight: 600 }}>
                    {formatNumber(row.total)}
                  </td>
                  <td className="gt-num">
                    <DiffPill percent={row.diffPercent} fiscalYearEnded={fiscalYearEnded} />
                  </td>
                  <td className="gt-num" style={{ padding: '12px 8px 12px 0' }}>
                    {/* 絞り込み操作を表すアイコン。選択中は常時表示し、それ以外は hover / フォーカス時に強調する */}
                    <ListFilter
                      size={14}
                      strokeWidth={2}
                      aria-hidden="true"
                      className={clsx('gt-row-filter-icon', isSelected && 'is-active')}
                      style={{ color: isSelected ? 'var(--color-primary)' : 'var(--color-text-subtle)' }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
