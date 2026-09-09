'use client';

// CalculationScheduler（services/calculationScheduler.ts）を React コンポーネントの寿命に結びつけるフック。
// スケジューラ本体は React に依存しないため、ここではインスタンスの保持・状態の反映・
// 最新のコールバックの引き渡し・アンマウント時の破棄だけを担う。

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalculationScheduler,
  INITIAL_SCHEDULER_STATE,
  type CalculationSchedulerDeps,
  type CalculationSchedulerState,
} from '../services/calculationScheduler';
import type { CalculationRunResult } from '../services/autoCalculation';

type SchedulerCallbacks = Pick<CalculationSchedulerDeps, 'execute' | 'onRetryFinished'>;

export interface UseCalculationSchedulerResult {
  state: CalculationSchedulerState;
  /** 保存・編集後の自動算定。再試行待ちの年度は予定済みの再試行に相乗りする。 */
  run: (fiscalYearIds: string[]) => Promise<CalculationRunResult>;
  /** 再試行待ちを取り消し、指定年度と待機中の年度をまとめて今すぐ実行する（手動の再計算）。 */
  runNow: (fiscalYearIds: string[]) => Promise<CalculationRunResult>;
}

export const useCalculationScheduler = (callbacks: SchedulerCallbacks): UseCalculationSchedulerResult => {
  const [state, setState] = useState<CalculationSchedulerState>(INITIAL_SCHEDULER_STATE);

  // execute / onRetryFinished は profile や履歴の状態を閉じ込めるためレンダーごとに変わる。
  // スケジューラは 1 インスタンスを使い回すため、ref 経由で常に最新の関数を呼ばせる。
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const schedulerRef = useRef<CalculationScheduler | null>(null);
  const getScheduler = useCallback((): CalculationScheduler => {
    if (schedulerRef.current === null) {
      schedulerRef.current = new CalculationScheduler({
        execute: (fiscalYearId) => callbacksRef.current.execute(fiscalYearId),
        onStateChange: setState,
        onRetryFinished: (result, gaveUp) => callbacksRef.current.onRetryFinished(result, gaveUp),
      });
    }
    return schedulerRef.current;
  }, []);

  useEffect(() => {
    return () => {
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
    };
  }, []);

  const run = useCallback((fiscalYearIds: string[]) => getScheduler().run(fiscalYearIds), [getScheduler]);
  const runNow = useCallback(
    (fiscalYearIds: string[]) => getScheduler().runNow(fiscalYearIds),
    [getScheduler],
  );

  return { state, run, runNow };
};
