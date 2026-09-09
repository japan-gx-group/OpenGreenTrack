'use client';

// 未算定の件数と、レート制限で持ち越した自動算定の待機状況。手動の再計算導線を兼ねる。
// 算定中・待機中・未算定ありのいずれでもなければ何も描画しない。

import { Calculator, Hourglass } from 'lucide-react';
import type { ActivityCalculation } from '../hooks/useActivityCalculation';

interface CalculationStatusBannerProps {
  calculation: ActivityCalculation;
  uncalculatedCount: number;
  /** 履歴の取り直し中は再計算ボタンを押せない */
  isRefreshingHistory: boolean;
}

export const CalculationStatusBanner = ({
  calculation,
  uncalculatedCount,
  isRefreshingHistory,
}: CalculationStatusBannerProps) => {
  if (!(calculation.isRunning || calculation.isWaiting || uncalculatedCount > 0)) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
      <div className="flex items-start gap-2">
        <Hourglass
          size={16}
          aria-hidden="true"
          className={calculation.isRunning ? 'mt-0.5 shrink-0 animate-pulse' : 'mt-0.5 shrink-0'}
        />
        <span>{calculation.statusText}</span>
      </div>
      <button
        type="button"
        className="gt-btn"
        onClick={calculation.recalculateUncalculated}
        disabled={calculation.isRunning || calculation.isRecalculating || isRefreshingHistory}
      >
        <Calculator size={15} /> {calculation.isWaiting ? '今すぐ再計算' : '未算定分を再計算'}
      </button>
    </div>
  );
};
