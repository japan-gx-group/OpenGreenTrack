// Scope 2 の基準別（GHG プロトコルのロケーション基準／マーケット基準）カード。
// 値は dashboard_aggregates の基準別列（refresh_dashboard_aggregates が明細 scope2_basis_results
// から絶対値で再計算した権威値）。null = 未算定で、0 とは区別して「—」表示する。
// 未算定は「算定の実行待ち」と「一部のレコードが算定できない」のどちらでも起きるため、
// 何件中何件そろっているか（coverage）と、それぞれの原因を案内する。
// Scope 別構成カードの Scope 2（温対法の係数区分に基づく単一値）とは独立の値のため、
// 並べて見ても一致するとは限らないことを注記で明示する。

import type { Scope2BasisCoverage, Scope2BasisTotals } from '../services/scopeAnalysisService';

const numberFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });

// 未算定があるときの原因の案内。算定バッチの起動経路は保存時の自動算定と「未算定分を再計算」
// （未算定レコードがあるときだけ表示）のため、常に使える「保存」を案内する。
const UNCALCULATED_GUIDANCE =
  '基準別の値は、排出量の算定時に Scope 2 のデータごとに付与されます。データ入力画面でこの年度の活動量を保存すると、その年度の算定が自動で実行されます。' +
  '算定後も値の無いデータは、対象年度に全国の代替値（公式の標準係数）が無いか、活動量の単位を係数の単位に換算できないため算定できなかったもので、算定完了時の通知に件数と理由が表示されます。';

// 未算定（null）の列に出す内訳。coverage は基準別合計に null があるときだけ取得される。
const uncalculatedDetail = (coverage: Scope2BasisCoverage | null, basisCount: number): string => {
  if (coverage === null || coverage.scope2RecordCount === 0) {
    return 'この年度の Scope 2 の算定結果がまだありません。';
  }
  if (basisCount >= coverage.scope2RecordCount) {
    // 明細はそろったが年度集計がまだ更新されていない（レコード削除の直後など）
    return 'すべての Scope 2 データにこの基準の値があります。年度合計は次回の算定で更新されます。';
  }
  return `Scope 2 の算定済みデータ ${numberFormatter.format(coverage.scope2RecordCount)} 件のうち、この基準の値があるのは ${numberFormatter.format(basisCount)} 件です。全件そろうまで合計は表示しません。`;
};

export const Scope2BasisCard = ({
  totals,
  coverage = null,
  isStale = false,
}: {
  totals: Scope2BasisTotals;
  /** 基準別の内訳（未算定の原因の案内用）。両基準とも値がある年度は null */
  coverage?: Scope2BasisCoverage | null;
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
      basisCount: coverage?.locationBasedCount ?? 0,
      breakdown: '全国代替値（公式係数）を一律に適用した値です。',
    },
    {
      key: 'market',
      label: 'マーケット基準',
      description: '契約に基づく係数で算定',
      value: totals.marketBased,
      basisCount: coverage?.marketBasedCount ?? 0,
      breakdown:
        totals.marketBased === null
          ? ''
          : `契約メニュー根拠 ${numberFormatter.format(totals.marketContract ?? 0)} ・ 代替値補完 ${numberFormatter.format(marketFallback ?? 0)} t-CO2e`,
    },
  ];
  const hasUncalculated = columns.some((column) => column.value === null);

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
              {column.value === null ? uncalculatedDetail(coverage, column.basisCount) : column.breakdown}
            </div>
          </div>
        ))}
      </div>

      {hasUncalculated && (
        <p style={{ marginTop: '18px', fontSize: '12.5px', color: 'var(--color-text-muted)' }}>
          {UNCALCULATED_GUIDANCE}
        </p>
      )}

      <p style={{ marginTop: '18px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
        ※ マーケット基準は、データ入力で供給事業者とメニューを選択した分を契約根拠として算定し、選択の無い分は
        全国代替値で補完します（補完分は契約情報の登録で置き換わります）。証書・クレジット等の環境価値の控除は
        未対応です。Scope 別構成の Scope 2（温対法の係数区分に基づく値）とは算定規則が異なるため、
        値は一致するとは限りません。
      </p>
    </section>
  );
};
