'use client';

// 「更新履歴」カード。直近のカスタム係数の追加・変更を並べ、「すべての履歴を表示」で全件モーダルを開く。

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import type { EmissionFactor } from '../services/factorService';
import { FACTOR_HISTORY_PREVIEW_COUNT, selectFactorHistory } from '../utils/factorHistory';
import { formatDate } from '../utils/formatDate';
import { FactorHistoryModal } from './FactorHistoryModal';

export const FactorHistoryCard = ({ database }: { database: EmissionFactor[] }) => {
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);

  // 公式係数は seed 一括投入で updatedAt が全件同着になるため、履歴の対象はカスタム係数のみ。
  const updateHistory = useMemo(
    () => selectFactorHistory(database).slice(0, FACTOR_HISTORY_PREVIEW_COUNT),
    [database],
  );

  return (
    <>
      <Card className="gt-col-4">
         <div className="flex justify-between items-center mb-4">
           <h3 className="gt-card-title">更新履歴</h3>
         </div>
         <div className="flex-col gap-6 text-sm relative" style={{ paddingLeft: '1rem' }}>
            <div style={{ position: 'absolute', left: '1.25rem', top: '0.5rem', bottom: '0', width: '2px', backgroundColor: 'var(--color-border-light)', zIndex: 0 }}></div>

            {updateHistory.length > 0 ? (
              updateHistory.map(item => (
                <div key={item.id} className="flex items-start gap-4 relative z-10">
                  <div className="flex items-center gap-2 w-24 flex-shrink-0">
                    <div className="w-3 h-3 rounded-full bg-success flex items-center justify-center" style={{marginLeft: '-0.3rem'}}></div>
                    <span className="font-medium">{formatDate(item.updatedAt)}</span>
                  </div>
                  <div>
                    <div className="font-bold mb-1">{item.name}</div>
                    <div className="text-xs text-text-muted">{item.source} / {item.applicableYear}年度</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs text-text-muted relative z-10">追加・変更したカスタム係数はまだありません。</div>
            )}
         </div>
         <div className="text-right mt-4">
           <button type="button" onClick={() => setIsHistoryModalOpen(true)} className="text-sm text-info hover:underline">
             すべての履歴を表示 &gt;
           </button>
         </div>
      </Card>

      {isHistoryModalOpen && (
        <FactorHistoryModal factors={database} onClose={() => setIsHistoryModalOpen(false)} />
      )}
    </>
  );
};
