// 計算結果ブロック（表示専用）。内容は services/entryFormat.ts の buildCalculationResultView が決める。

import React from 'react';
import type { CalculationResultView } from '../services/entryFormat';

export const EntryCalculationResult = ({ view }: { view: CalculationResultView }) => {
  if (view.kind === 'idle') {
    return <p className="text-sm text-text-muted">{view.message}</p>;
  }
  if (view.kind === 'unit-mismatch') {
    return <p className="text-sm text-warning">{view.message}</p>;
  }
  return (
    <div
      data-testid="manual-calculation-result"
      className="rounded-sm border border-primary bg-primary-light px-4 py-3 text-sm"
    >
      <span className="text-text-muted">計算結果: </span>
      <span className="text-text-main">
        {view.amountText} {view.unit} × {view.factorText} ={' '}
      </span>
      <span className="font-serif text-base font-bold text-primary-dark">{view.emissionsText}</span>
    </div>
  );
};
