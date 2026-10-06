// Scope 2 の基準別（GHG プロトコルのロケーション基準／マーケット基準）カード。
// 値は dashboard_aggregates の基準別列（refresh_dashboard_aggregates が明細 scope2_basis_results
// から絶対値で再計算した権威値）。null = 未算定で、0 とは区別して「—」表示する。
// Scope 別構成カードの Scope 2（温対法の係数区分に基づく単一値）とは独立の値のため、
// 並べて見ても一致するとは限らないことを注記で明示する。

import type { Scope2BasisTotals } from '../services/scopeAnalysisService';

const numberFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });

export const Scope2BasisCard = ({
  totals,
  isStale = false,
}: {
  totals: Scope2BasisTotals;
  isStale?: boolean;
}) => {
  const marketFallback =
    totals.marketBased !== null && totals.marketContract !== null
      ? totals.marketBased - totals.marketContract
      : null;

  const columns = [
    {
      key: 'location',
      label: 'ロケーション基準',
      description: '系統平均の係数で算定',
      value: totals.locationBased,
      breakdown: '全国代替値（公式係数）を一律に適用した値です。',
    },
    {
      key: 'market',
      label: 'マーケット基準',
      description: '契約に基づく係数で算定',
      value: totals.marketBased,
      breakdown:
        totals.marketBased === null
          ? ''
          : `契約メニュー根拠 ${numberFormatter.format(totals.marketContract ?? 0)} ・ 代替値補完 ${numberFormatter.format(marketFallback ?? 0)} t-CO2e`,
    },
  ];

  return (
    <section className="gt-card">
      <div className="gt-card-head">
        <div>
          <h2 className="gt-card-title">Scope 2 算定基準別</h2>
          <p className="gt-card-sub">GHG プロトコルの 2 基準・単位 t-CO2e</p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          marginTop: '18px',
          opacity: isStale ? 0.45 : 1,
          transition: 'opacity .25s',
        }}
      >
        {columns.map((column, index) => (
          <div
            key={column.key}
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
                  backgroundColor: 'var(--color-scope-2)',
                }}
              />
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-heading)' }}>
                {column.label}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--color-text-subtle)' }}>
                {column.description}
              </span>
            </div>
            <div className="flex items-baseline" style={{ gap: '7px', marginTop: '9px' }}>
              <span style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.025em' }}>
                {column.value === null ? '—' : numberFormatter.format(column.value)}
              </span>
              <span style={{ fontSize: '12.5px', color: 'var(--color-text-subtle)' }}>
                {column.value === null ? '未算定' : 't-CO2e'}
              </span>
            </div>
            <div style={{ marginTop: '9px', fontSize: '12.5px', color: 'var(--color-text-muted)' }}>
              {column.value === null
                ? 'データ入力画面で「排出量を算定」を実行すると表示されます。'
                : column.breakdown}
            </div>
          </div>
        ))}
      </div>

      <p style={{ marginTop: '18px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
        ※ マーケット基準は、データ入力で供給事業者とメニューを選択した分を契約根拠として算定し、選択の無い分は
        全国代替値で補完します（補完分は契約情報の登録で置き換わります）。証書・クレジット等の環境価値の控除は
        未対応です。Scope 別構成の Scope 2（温対法の係数区分に基づく値）とは算定規則が異なるため、
        値は一致するとは限りません。
      </p>
    </section>
  );
};
