'use client';

// 正式係数の公表により再算定が必要になった年度。
// 対象年度の公式係数が未公表の間は過年度の係数を暫定適用して算定するが、正式係数を投入しても
// 算定バッチは未算定レコードしか処理しないため、算定済みの結果は古い係数のまま残る。
// 画面表示のたびに件数を取り直し、対象があるときだけ差し戻し＋再算定の導線を出す。

import { useEffect, useState } from 'react';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import type { ShowToast } from '@/hooks/useToast';
import { buildCalculationMessages } from '../services/autoCalculation';
import {
  buildProvisionalResetMessages,
  fetchProvisionalRecalculationTargets,
  requestProvisionalReset,
  type ProvisionalRecalculationTarget,
} from '../services/provisionalRecalculation';
import type { ActivityCalculation } from './useActivityCalculation';

export interface UseProvisionalRecalculationParams {
  /** 差し戻した年度を続けて算定する */
  runCalculationNow: ActivityCalculation['runNow'];
  refreshHistory: () => Promise<void>;
  showToast: ShowToast;
}

export interface ProvisionalRecalculation {
  targets: ProvisionalRecalculationTarget[];
  isRecalculating: boolean;
  recalculate: () => Promise<void>;
}

export function useProvisionalRecalculation({
  runCalculationNow,
  refreshHistory,
  showToast,
}: UseProvisionalRecalculationParams): ProvisionalRecalculation {
  const { refreshToken } = useAppRefresh();
  const [targets, setTargets] = useState<ProvisionalRecalculationTarget[]>([]);
  const [isRecalculating, setIsRecalculating] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void fetchProvisionalRecalculationTargets().then((fetched) => {
      if (isMounted) {
        setTargets(fetched);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  // 暫定適用で算定済みのレコードを再算定対象へ戻し、続けて算定し直す。
  // 差し戻しだけで終わるとその分の排出量が未算定のまま残るため、戻せた年度は必ず算定まで通す
  // （算定は既存の /api/calculations 経由。429 の持ち越し・自動再試行もそのまま効く）。
  const recalculate = async () => {
    if (targets.length === 0) {
      return;
    }
    setIsRecalculating(true);
    try {
      const resets = await Promise.all(
        targets.map((target) => requestProvisionalReset(target.fiscalYearId)),
      );
      const messages = buildProvisionalResetMessages(resets);
      const resetFiscalYearIds = targets.flatMap((target, index) => {
        const reset = resets[index];
        return reset.kind === 'reset' && reset.resetCount > 0 ? [target.fiscalYearId] : [];
      });
      if (resetFiscalYearIds.length > 0) {
        const result = await runCalculationNow(resetFiscalYearIds);
        messages.push(...buildCalculationMessages(result, { uncoveredCount: 0, isRetry: true }));
      }
      await refreshHistory();
      setTargets(await fetchProvisionalRecalculationTargets());
      showToast(messages.join('\n'), 'success');
    } finally {
      setIsRecalculating(false);
    }
  };

  return { targets, isRecalculating, recalculate };
}
