// Scope 別構成カード（デザイン正）。1本の帯で構成比を見せ、その下に Scope ごとの
// 実数と構成比を3列で並べる。数値の正本はダッシュボードと同じ dashboard_aggregates。

import type { ScopeTotals } from '../services/scopeAnalysisService';

const numberFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });

const SCOPES = [
  { key: 'scope1', label: 'Scope 1', description: '自社の直接排出', color: 'var(--color-scope-1)' },
  { key: 'scope2', label: 'Scope 2', description: '購入エネルギー', color: 'var(--color-scope-2)' },
  { key: 'scope3', label: 'Scope 3', description: 'サプライチェーン', color: 'var(--color-scope-3)' },
] as const;

export const ScopeMixCard = ({ totals, isStale = false }: { totals: ScopeTotals; isStale?: boolean }) => {
  const rows = SCOPES.map((scope, index) => {
    const value = totals[scope.key];
    const share = totals.total > 0 ? (value / totals.total) * 100 : 0;
    return {
      ...scope,
      value,
      share,
      // 帯の両端だけ角を丸める（中間セグメントは角無し）。
      roundedClass:
        index === 0 ? 'rounded-l-full' : index === SCOPES.length - 1 ? 'rounded-r-full' : '',
    };
  });

  return (
    <section className="gt-card">
      <div className="gt-card-head">
        <div>
          <h2 className="gt-card-title">Scope 別構成</h2>
          <p className="gt-card-sub">
            合計 {numberFormatter.format(totals.total)} t-CO2e・Scope 1・2・3 の構成比
          </p>
        </div>
      </div>

      <div
        className="flex"
        style={{ gap: '2px', height: '14px', marginTop: '18px', opacity: isStale ? 0.45 : 1, transition: 'opacity .25s' }}
      >
        {rows.map(row => (
          <div
            key={row.key}
            title={`${row.label} ${row.share.toFixed(1)}%`}
            className={row.roundedClass}
            style={{
              width: `${row.share}%`,
              backgroundColor: row.color,
              transition: 'width .5s cubic-bezier(.2,.7,.2,1)',
            }}
          />
        ))}
        {totals.total === 0 && (
          <div className="rounded-full" style={{ width: '100%', backgroundColor: 'var(--color-chart-track)' }} />
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          marginTop: '20px',
          opacity: isStale ? 0.45 : 1,
          transition: 'opacity .25s',
        }}
      >
        {rows.map((row, index) => (
          <div
            key={row.key}
            style={{
              padding: '0 24px',
              borderLeft: index === 0 ? 'none' : '1px solid var(--color-border)',
            }}
          >
            <div className="flex items-center" style={{ gap: '9px' }}>
              <span
                className="rounded-full"
                style={{
                  width: '9px',
                  height: '9px',
                  flex: 'none',
                  backgroundColor: row.color,
                }}
              />
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-heading)' }}>{row.label}</span>
              <span style={{ fontSize: '12px', color: 'var(--color-text-subtle)' }}>{row.description}</span>
            </div>
            <div className="flex items-baseline" style={{ gap: '7px', marginTop: '9px' }}>
              <span style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.025em' }}>
                {numberFormatter.format(row.value)}
              </span>
              <span style={{ fontSize: '12.5px', color: 'var(--color-text-subtle)' }}>t-CO2e</span>
            </div>
            <div style={{ marginTop: '9px', fontSize: '12.5px', color: 'var(--color-text-muted)' }}>
              構成比 {row.share.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
