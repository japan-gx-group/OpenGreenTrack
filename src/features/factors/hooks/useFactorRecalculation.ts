'use client';

// カスタム係数の値を変えたあとの再算定（係数管理画面）。
// その係数で算定済みのレコードを再算定対象へ戻し（/api/calculations/factor-recalculation）、
// 戻した年度を既存の /api/calculations で算定し直す。差し戻しだけで終わるとその分の排出量が
// 未算定のまま残るため、戻せた年度は必ず算定まで通す（429 の持ち越し・自動再試行もそのまま効く）。

import { useState } from 'react';
import type { ShowToast } from '@/hooks/useToast';
import { useCalculationScheduler } from '@/features/data-input/hooks/useCalculationScheduler';
import {
  RETRY_GAVE_UP_MESSAGE,
  buildCalculationMessages,
  requestCalculationBatch,
  type CalculationBatchRequestResult,
} from '@/features/data-input/services/autoCalculation';
import { buildFactorResetMessages, requestFactorRecalculationReset } from '../services/factorRecalculation';
import type { EmissionFactor } from '../services/factorService';

export interface UseFactorRecalculationParams {
  /** /api/calculations に渡す組織 id。プロフィール未取得なら null */
  organizationId: string | null;
  showToast: ShowToast;
}

export interface FactorRecalculation {
  isRecalculating: boolean;
  recalculate: (factor: EmissionFactor) => Promise<void>;
}

export function useFactorRecalculation({
  organizationId,
  showToast,
}: UseFactorRecalculationParams): FactorRecalculation {
  const [isRecalculating, setIsRecalculating] = useState(false);
  const { runNow } = useCalculationScheduler({
    execute: (fiscalYearId): Promise<CalculationBatchRequestResult> =>
      organizationId
        ? requestCalculationBatch(organizationId, fiscalYearId)
        : Promise.resolve({ kind: 'failed', message: '組織情報を確認できませんでした。' }),
    onRetryFinished: (result, gaveUp) => {
      const messages = gaveUp
        ? [RETRY_GAVE_UP_MESSAGE]
        : buildCalculationMessages(result, { uncoveredCount: 0, isRetry: true });
      showToast(messages.join('\n'), gaveUp ? 'error' : 'success');
    },
  });

  const recalculate = async (factor: EmissionFactor) => {
    setIsRecalculating(true);
    try {
      const reset = await requestFactorRecalculationReset(factor.id);
      const messages = buildFactorResetMessages(factor.name, reset);
      if (reset.kind === 'reset' && reset.fiscalYearIds.length > 0) {
        const result = await runNow(reset.fiscalYearIds);
        messages.push(...buildCalculationMessages(result, { uncoveredCount: 0, isRetry: true }));
      }
      showToast(messages.join('\n'), reset.kind === 'failed' ? 'error' : 'success');
    } finally {
      setIsRecalculating(false);
    }
  };

  return { isRecalculating, recalculate };
}
