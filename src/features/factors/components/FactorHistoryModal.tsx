import React, { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import type { EmissionFactor } from '../services/factorService';
import { FactorModal } from './FactorModal';
import { formatFactorDate } from '../utils/factorFormat';
import { FACTOR_HISTORY_PAGE_SIZE, selectFactorHistory } from '../utils/factorHistory';

type FactorHistoryModalProps = {
  factors: EmissionFactor[];
  onClose: () => void;
};

// 「すべての履歴を表示」から開く。更新日時を持つ係数を新しい順に一覧する
// （画面下部の要約は最新3件のみ）。
// 対象はカスタム係数のみ（selectFactorHistory を参照）。全行がカスタムなので「種別」列は持たない。
// 全件を一度に <tr> 化すると件数次第でタブが固まるため、FACTOR_HISTORY_PAGE_SIZE 行ずつ「さらに表示」で追加描画する。
export const FactorHistoryModal = ({ factors, onClose }: FactorHistoryModalProps) => {
  const history = useMemo(() => selectFactorHistory(factors), [factors]);
  const [visibleCount, setVisibleCount] = useState(FACTOR_HISTORY_PAGE_SIZE);
  const visibleHistory = history.slice(0, visibleCount);
  const remainingCount = history.length - visibleHistory.length;

  return (
    <FactorModal title="係数更新履歴（全件）" icon={History} onClose={onClose} maxWidth="720px">
      {history.length === 0 ? (
        <p className="text-sm text-text-muted">追加・変更したカスタム係数はまだありません。</p>
      ) : (
        <>
          <p className="text-sm text-text-muted mb-4">
            追加・変更したカスタム係数 {history.length} 件を更新日時の新しい順に表示しています
            {remainingCount > 0 ? `（${visibleHistory.length} 件まで表示中）` : ''}。
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="text-sm w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                  <th className="pb-2 pr-4 text-[10px] font-medium uppercase tracking-wider text-text-subtle">更新日</th>
                  <th className="pb-2 pr-4 text-[10px] font-medium uppercase tracking-wider text-text-subtle">係数名</th>
                  <th className="pb-2 pr-4 text-[10px] font-medium uppercase tracking-wider text-text-subtle">発行元</th>
                  <th className="pb-2 pr-4 text-[10px] font-medium uppercase tracking-wider text-text-subtle">適用年度</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                    <td className="py-2 pr-4 font-medium whitespace-nowrap">{formatFactorDate(item.updatedAt)}</td>
                    <td className="py-2 pr-4">{item.name}</td>
                    <td className="py-2 pr-4 text-text-muted">{item.source}</td>
                    <td className="py-2 pr-4">{item.applicableYear}年度</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {remainingCount > 0 && (
            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + FACTOR_HISTORY_PAGE_SIZE)}
                className="text-sm text-info hover:underline"
              >
                さらに {Math.min(remainingCount, FACTOR_HISTORY_PAGE_SIZE)} 件を表示（残り {remainingCount} 件）
              </button>
            </div>
          )}
        </>
      )}
    </FactorModal>
  );
};
