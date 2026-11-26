'use client';

// 該当性・重要性の判断の一覧で、選んだ要求にまとめて該当性・重要性を付ける帯。
// 保存は呼び出し元（onApply）が 1 件ずつ一覧の保存（詳細と同じ検証・読込時の更新日時を条件にした保存）で行い、
// 保存できなかった要求は理由を並べる。どちらも「変えない」のままでは付けられない。
// 件数（count）は、表示中で選んでいる要求の数（絞り込みで見えない要求は数えない・付けない）。

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  SSBJ_APPLICABILITIES,
  SSBJ_MATERIALITIES,
  type SsbjApplicability,
  type SsbjMateriality,
  type SsbjRequirementId,
} from '../types';
import { SSBJ_APPLICABILITY_LABELS, SSBJ_MATERIALITY_LABELS, type SsbjJudgementQuickChange } from '../utils/judgement';

export interface SsbjJudgementBulkResult {
  saved: SsbjRequirementId[];
  failed: { requirementId: SsbjRequirementId; message: string }[];
}

interface SsbjJudgementBulkBarProps {
  /** 表示中で選んでいる要求の数。 */
  count: number;
  onApply: (change: SsbjJudgementQuickChange) => Promise<SsbjJudgementBulkResult>;
  onClear: () => void;
}

const KEEP = 'keep';

export const SsbjJudgementBulkBar = ({ count, onApply, onClear }: SsbjJudgementBulkBarProps) => {
  const id = useId();
  const [applicability, setApplicability] = useState<SsbjApplicability | typeof KEEP>(KEEP);
  const [materiality, setMateriality] = useState<SsbjMateriality | typeof KEEP>(KEEP);
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<SsbjJudgementBulkResult | null>(null);

  const change: SsbjJudgementQuickChange = {
    ...(applicability === KEEP ? {} : { applicability }),
    ...(materiality === KEEP ? {} : { materiality }),
  };
  const hasChange = Object.keys(change).length > 0;

  const apply = async () => {
    if (!hasChange || count === 0 || isApplying) return;
    setIsApplying(true);
    setResult(null);
    try {
      setResult(await onApply(change));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div data-testid="ssbj-judgement-bulk-bar" className="flex flex-col gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2">
      <div className="flex flex-wrap items-end gap-3">
        <p className="m-0 self-center text-sm font-semibold">選んだ要求 {count} 件に</p>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-applicability`} className="text-xs">該当性</Label>
          <select
            id={`${id}-applicability`}
            className="gt-field gt-field-select min-w-36"
            value={applicability}
            disabled={isApplying}
            onChange={event => setApplicability(event.target.value as SsbjApplicability | typeof KEEP)}
          >
            <option value={KEEP}>変えない</option>
            {SSBJ_APPLICABILITIES.map(value => <option key={value} value={value}>{SSBJ_APPLICABILITY_LABELS[value]}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-materiality`} className="text-xs">重要性</Label>
          <select
            id={`${id}-materiality`}
            className="gt-field gt-field-select min-w-36"
            value={materiality}
            disabled={isApplying}
            onChange={event => setMateriality(event.target.value as SsbjMateriality | typeof KEEP)}
          >
            <option value={KEEP}>変えない</option>
            {SSBJ_MATERIALITIES.map(value => <option key={value} value={value}>{SSBJ_MATERIALITY_LABELS[value]}</option>)}
          </select>
        </div>
        <Button type="button" disabled={!hasChange || count === 0 || isApplying} onClick={() => void apply()}>
          {isApplying ? '保存中...' : 'まとめて付ける'}
        </Button>
        <Button type="button" variant="ghost" disabled={count === 0 || isApplying} onClick={onClear}>
          選択を外す
        </Button>
      </div>
      {result && (
        <div role="status" className="text-xs">
          <p className="m-0">
            {result.saved.length} 件を保存しました。
            {result.failed.length > 0 && `${result.failed.length} 件は保存できませんでした（選んだままにしています）。`}
          </p>
          {result.failed.length > 0 && (
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-danger">
              {result.failed.map(failure => <li key={failure.requirementId}>{failure.requirementId}: {failure.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
