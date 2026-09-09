'use client';

// 保存した活動量の排出量の自動計算と、未算定分の手動再計算。
// 対象年度はレコードの periodStart から導出する（年度セレクタ非表示のため選択年度に依存しない）。
// データの保存自体は完了しているため、計算の失敗は throw せず通知メッセージとして返す。
// /api/calculations は年度単位のバッチで、未算定レコードをまとめて処理する
// （過去に係数未解決で残ったレコードも一緒に算定される）。
//
// /api/calculations には組織単位のレート制限（同時1件・1分あたりN件）があり、連続入力や
// 複数人での入力で 429 に当たり得る。弾かれた年度は CalculationScheduler が Retry-After 後に
// 自動で再試行し、待機中に保存した分も同じ再試行に相乗りさせる（未算定データを黙って残さない）。
// 再試行の完了は onRetryFinished で受け取り、履歴を取り直して結果を通知する。

import { useCallback, useEffect, useState } from 'react';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import type { ShowToast } from '@/hooks/useToast';
import {
  RETRY_GAVE_UP_MESSAGE,
  buildCalculationMessages,
  requestCalculationBatch,
  type CalculationBatchRequestResult,
} from '../services/autoCalculation';
import { collectFiscalYearIdsForPeriodStarts } from '../services/inlineCalculation';
import { useCalculationScheduler } from './useCalculationScheduler';
import type { HistoryItem } from './useActivityHistory';

export interface UseActivityCalculationParams {
  /** 保存後の自動計算（/api/calculations）に渡す組織 id。プロフィール未取得なら null */
  organizationId: string | null;
  fiscalYears: FiscalYearOption[];
  uncalculatedItems: HistoryItem[];
  /** 算定後に一覧を取り直して排出量の列を反映する */
  refreshHistory: () => Promise<void>;
  showToast: ShowToast;
}

export interface ActivityCalculation {
  /** 保存した年月の年度をまとめて算定する。結果は通知メッセージとして返す */
  runAutoCalculation: (periodStarts: string[]) => Promise<string[]>;
  /** 再試行待ちを取り消して今すぐ算定する（正式係数での再算定など、他の導線からも使う） */
  runNow: ReturnType<typeof useCalculationScheduler>['runNow'];
  isRunning: boolean;
  /** レート制限で持ち越し、自動再試行を待っている */
  isWaiting: boolean;
  /** 「未算定分を再計算」の実行中 */
  isRecalculating: boolean;
  recalculateUncalculated: () => Promise<void>;
  /** 未算定件数と待機状況の案内文 */
  statusText: string;
}

export function useActivityCalculation({
  organizationId,
  fiscalYears,
  uncalculatedItems,
  refreshHistory,
  showToast,
}: UseActivityCalculationParams): ActivityCalculation {
  const { state: calculationState, run: runScheduledCalculation, runNow } =
    useCalculationScheduler({
      execute: (fiscalYearId): Promise<CalculationBatchRequestResult> =>
        organizationId
          ? requestCalculationBatch(organizationId, fiscalYearId)
          : Promise.resolve({ kind: 'failed', message: '組織情報を確認できませんでした。' }),
      onRetryFinished: (result, gaveUp) => {
        void refreshHistory();
        const messages = gaveUp
          ? [RETRY_GAVE_UP_MESSAGE]
          : buildCalculationMessages(result, { uncoveredCount: 0, isRetry: true });
        showToast(messages.join('\n'), gaveUp ? 'error' : 'success');
      },
    });
  const isWaiting = calculationState.retryAt !== null;

  const runAutoCalculation = useCallback(
    async (periodStarts: string[]): Promise<string[]> => {
      if (!organizationId) {
        return ['組織情報を確認できなかったため、排出量の自動計算をスキップしました。'];
      }
      const { fiscalYearIds, uncoveredCount } = collectFiscalYearIdsForPeriodStarts(
        fiscalYears,
        periodStarts,
      );
      const result = await runScheduledCalculation(fiscalYearIds);
      return buildCalculationMessages(result, { uncoveredCount });
    },
    [organizationId, fiscalYears, runScheduledCalculation],
  );

  // 手動の再計算。再試行待ちがあれば取り消して今すぐ実行し、未算定レコードの年度もまとめて対象にする。
  const [isRecalculating, setIsRecalculating] = useState(false);
  const recalculateUncalculated = async () => {
    if (!organizationId) {
      showToast('組織情報を確認できないため、排出量を再計算できません。', 'error');
      return;
    }
    setIsRecalculating(true);
    try {
      const periodStarts = uncalculatedItems
        .map((item) => item.record?.periodStart)
        .filter((periodStart): periodStart is string => typeof periodStart === 'string');
      const { fiscalYearIds, uncoveredCount } = collectFiscalYearIdsForPeriodStarts(
        fiscalYears,
        periodStarts,
      );
      const result = await runNow(fiscalYearIds);
      await refreshHistory();
      showToast(buildCalculationMessages(result, { uncoveredCount, isRetry: true }).join('\n'), 'success');
    } finally {
      setIsRecalculating(false);
    }
  };

  // 自動再試行までの残り秒数（表示用）。retryAt が変わるたびに 1 秒刻みで更新する。
  const [retryCountdownSeconds, setRetryCountdownSeconds] = useState<number | null>(null);
  useEffect(() => {
    const retryAt = calculationState.retryAt;
    if (retryAt === null) {
      return;
    }
    const update = () => setRetryCountdownSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    // 初回はマイクロタスクではなくタイマーで更新する（effect 内の同期 setState を避ける）。
    const initial = setTimeout(update, 0);
    const interval = setInterval(update, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [calculationState.retryAt]);

  const statusText = calculationState.isRunning
    ? '排出量を計算しています...'
    : isWaiting
      ? `排出量の自動計算が混み合っています。未算定 ${uncalculatedItems.length} 件を${
          retryCountdownSeconds === null || retryCountdownSeconds === 0
            ? 'まもなく'
            : `約${retryCountdownSeconds}秒後に`
        }自動で再試行します。この画面を開いたままお待ちください。`
      : `未算定 ${uncalculatedItems.length} 件があります。排出係数を登録した後や自動計算に失敗したときは、ここから再計算できます。`;

  return {
    runAutoCalculation,
    runNow,
    isRunning: calculationState.isRunning,
    isWaiting,
    isRecalculating,
    recalculateUncalculated,
    statusText,
  };
}
