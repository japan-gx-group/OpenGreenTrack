'use client';

// 複数月まとめて入力（一括入力）の活動量グリッド。対象年度の各月を 1 行ずつ並べ、
// 未来月は入力不可、登録済みの月は値を表示してスキップ（既定）か上書きを選べるようにする。
// 行の状態判定は services/bulkEntry.ts、状態は hooks/useBulkMonthEntries.ts が持ち、
// この部品は描画と入力イベントの橋渡しだけを行う。

import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { amountFieldLabel } from '../services/entryFormat';
import { AMOUNT_INPUT_REJECTED_MESSAGE } from '../services/entrySubmission';
import type { BulkMonthRow } from '../services/bulkEntry';

export interface ActivityEntryBulkSectionProps {
  rows: BulkMonthRow[];
  amounts: Record<string, string>;
  /** 正規化しても数字にならず弾いた月（行の直下に理由を出す） */
  amountRejected: Record<string, boolean>;
  overwriteEnabled: Record<string, boolean>;
  unit: string | null;
  /** 活動量の数え方の補足（単月入力と同じ文言）。null なら出さない */
  amountGuide: string | null;
  disabled: boolean;
  onAmountChange: (month: string, value: string) => void;
  /** IME 変換の開始・確定（変換中の値を巻き戻さないために、状態側へ伝える） */
  onAmountCompositionStart: (month: string) => void;
  onAmountCompositionEnd: (month: string, value: string) => void;
  onToggleOverwrite: (month: string) => void;
}

export const ActivityEntryBulkSection = ({
  rows,
  amounts,
  amountRejected,
  overwriteEnabled,
  unit,
  amountGuide,
  disabled,
  onAmountChange,
  onAmountCompositionStart,
  onAmountCompositionEnd,
  onToggleOverwrite,
}: ActivityEntryBulkSectionProps) => (
  <div className="flex flex-col gap-2" data-testid="manual-bulk-grid">
    <p className="text-sm font-medium text-text-muted">{amountFieldLabel(unit)}</p>
    {amountGuide && <p className="text-xs text-text-muted">{amountGuide}</p>}

    <div className="divide-y divide-border-light rounded-md border border-border-light">
      {rows.map((row) => {
        const overwriting = row.canOverwrite && overwriteEnabled[row.month] === true;
        const inputDisabled = disabled || row.isFuture || (row.existing !== null && !overwriting);
        return (
          <div key={row.month} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
            <label
              htmlFor={`manual-bulk-amount-${row.month}`}
              className="w-24 shrink-0 text-sm font-medium text-text-muted"
            >
              {row.label}
            </label>
            <input
              id={`manual-bulk-amount-${row.month}`}
              type="text"
              inputMode="decimal"
              placeholder={row.isFuture || (row.existing !== null && !overwriting) ? '' : '0.000'}
              value={amounts[row.month] ?? ''}
              onChange={(event) => onAmountChange(row.month, event.target.value)}
              onCompositionStart={() => onAmountCompositionStart(row.month)}
              onCompositionEnd={(event) => onAmountCompositionEnd(row.month, event.currentTarget.value)}
              disabled={inputDisabled}
              className="gt-field w-40 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {amountRejected[row.month] === true && (
              <span className="text-xs text-danger" data-testid={`manual-bulk-amount-rejected-${row.month}`}>
                {AMOUNT_INPUT_REJECTED_MESSAGE}
              </span>
            )}
            {row.isFuture && <span className="text-xs text-text-muted">未来月のため入力できません</span>}
            {row.existing !== null && !row.isFuture && (
              <>
                <span className="text-xs text-text-muted">
                  登録済み: {row.existing.amount.toLocaleString()} {row.existing.unit}
                </span>
                {row.canOverwrite ? (
                  <label
                    htmlFor={`manual-bulk-overwrite-${row.month}`}
                    className="flex items-center gap-1.5 text-xs text-text-main"
                  >
                    <Checkbox
                      id={`manual-bulk-overwrite-${row.month}`}
                      checked={overwriteEnabled[row.month] === true}
                      onCheckedChange={() => onToggleOverwrite(row.month)}
                      disabled={disabled}
                    />
                    上書きする
                  </label>
                ) : (
                  <span className="text-xs text-warning">
                    単位が異なるため上書きできません（入力履歴から編集してください）
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>

    {/* 月ごとの適用係数・推定排出量は入力プレビューで確認する（係数は月の属する温対法年度で変わり得るため）。 */}
    <p className="text-xs text-text-muted">
      空欄の月は登録されません。月ごとの適用係数と推定排出量は入力プレビューで確認できます。
    </p>
  </div>
);
