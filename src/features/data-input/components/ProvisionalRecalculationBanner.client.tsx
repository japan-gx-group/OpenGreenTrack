'use client';

// 正式係数の公表で古くなった算定済みデータ。バッジが消えるだけでは
// 「正式値で運用中」に見えてしまうため、対象がある間は再算定の導線とともに明示する。

import { AlertTriangle, Calculator } from 'lucide-react';
import type { ProvisionalRecalculation } from '../hooks/useProvisionalRecalculation';
import { buildProvisionalRecalculationNotice } from '../services/provisionalRecalculation';

interface ProvisionalRecalculationBannerProps {
  provisional: ProvisionalRecalculation;
  /** 他の算定・取り直しが進行中は押せない */
  disabled: boolean;
}

export const ProvisionalRecalculationBanner = ({ provisional, disabled }: ProvisionalRecalculationBannerProps) => {
  if (provisional.targets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{buildProvisionalRecalculationNotice(provisional.targets)}</span>
      </div>
      <button
        type="button"
        className="gt-btn"
        onClick={provisional.recalculate}
        disabled={disabled || provisional.isRecalculating}
      >
        <Calculator size={15} /> 正式係数で再算定
      </button>
    </div>
  );
};
