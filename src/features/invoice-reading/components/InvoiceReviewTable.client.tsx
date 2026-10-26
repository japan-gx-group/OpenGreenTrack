'use client';

// 請求書から読み取った明細を確かめる表。1 行 = 1 明細で、拠点・対象年月・活動量・排出係数を表の中で直せる。
// 「登録する」にチェックした行だけを、カードの「選んだ明細を登録」でまとめて登録する（保存は人が行う）。
// 1 件ずつ直したい行は「フォームで開く」で統合入力フォームに入れる（帳票も一緒に入る）。

import React from 'react';
import { ArrowDownToLine, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MANUAL_ACTIVITY_CATEGORY_MAP, type ActivityEntryPrefill, type ManualEntryLocationOption } from '@/features/data-input/types';
import { normalizeAmountInput } from '@/features/data-input/services/entrySubmission';
import { openEvidenceFile } from '@/features/activity-evidence/services/evidenceClient';
import type { InvoiceReviewRows, ReviewRow } from '../hooks/useInvoiceReviewRows';
import { InvoiceJudgementBadge } from './InvoiceJudgementBadge';

const formatEmissions = (value: number | null) => (value === null ? '—' : `${value.toLocaleString('ja-JP')} t-CO2e`);

const FactorCell = ({
  row,
  review,
  disabled,
}: {
  row: ReviewRow;
  review: InvoiceReviewRows;
  disabled: boolean;
}) => {
  const key = row.source.key;
  if (row.factorError) return <span className="text-xs text-danger">{row.factorError}</span>;
  if (!row.view) {
    return <span className="text-xs text-text-muted">{row.check.errors.length > 0 ? '拠点・対象年月を決めると表示します' : '確認しています...'}</span>;
  }
  const view = row.view;
  return (
    <span className="flex flex-col gap-1">
      {view.isProvider && (
        <select
          aria-label="供給事業者"
          className="gt-field h-8 text-xs"
          value={row.values.providerName ?? ''}
          disabled={disabled}
          onChange={(event) => review.setValue(key, { providerName: event.target.value || null })}
        >
          <option value="">事業者を選ばない（代替値）</option>
          {/* 読み取った事業者が、この年度の一覧に無いときも選んだままにする */}
          {row.values.providerName && !view.providerOptions.some((option) => option.value === row.values.providerName) && (
            <option value={row.values.providerName}>{row.values.providerName}（この年度の係数なし）</option>
          )}
          {view.providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {view.isProvider && view.menuOptions.length > 1 && (
        <select
          aria-label="メニュー"
          className="gt-field h-8 text-xs"
          value={row.values.menuName ?? ''}
          disabled={disabled}
          onChange={(event) => review.setValue(key, { menuName: event.target.value || null })}
        >
          <option value="">メニューを選んでください</option>
          {view.menuOptions.map((factor) => (
            <option key={factor.id} value={factor.menuName ?? ''}>
              {factor.menuName}
            </option>
          ))}
        </select>
      )}
      {!view.providerFactor && view.candidates.length > 0 && (
        <select
          aria-label="排出係数"
          className="gt-field h-8 text-xs"
          value={view.selectedFactor?.id ?? ''}
          disabled={disabled}
          onChange={(event) => review.setValue(key, { selectedFactorId: event.target.value, factorName: null })}
        >
          {view.candidates.map((factor) => (
            <option key={factor.id} value={factor.id}>
              {factor.name}（{factor.factorValue} {factor.unit}）
            </option>
          ))}
        </select>
      )}
      {view.applied.status === 'resolved' && view.applied.factor && (
        <span className="text-xs text-text-muted">
          適用: {view.applied.factor.factorValue} {view.applied.factor.unit}
          {view.applied.provisional && '（前年度の係数を暫定適用）'}
        </span>
      )}
    </span>
  );
};

export const InvoiceReviewTable = ({
  review,
  locations,
  onApply,
  disabled = false,
}: {
  review: InvoiceReviewRows;
  locations: readonly ManualEntryLocationOption[];
  onApply: (prefill: ActivityEntryPrefill) => void;
  disabled?: boolean;
}) => (
  <div className="overflow-x-auto" data-testid="invoice-review-table">
    <table className="gt-table">
      <thead>
        <tr>
          <th style={{ width: '56px' }}>登録</th>
          <th style={{ minWidth: '160px' }}>帳票</th>
          <th style={{ minWidth: '150px' }}>拠点</th>
          <th style={{ minWidth: '140px' }}>対象年月</th>
          <th style={{ minWidth: '150px' }}>活動量</th>
          <th style={{ minWidth: '240px' }}>排出係数</th>
          <th className="gt-num" style={{ minWidth: '110px' }}>
            排出量
          </th>
          <th style={{ minWidth: '220px' }}>判定・確かめること</th>
          <th aria-label="操作" />
        </tr>
      </thead>
      <tbody>
        {review.rows.map((row) => {
          const key = row.source.key;
          const unit = MANUAL_ACTIVITY_CATEGORY_MAP[row.source.energyType].unit;
          return (
            <tr key={key} data-testid="invoice-review-row">
              <td>
                <input
                  type="checkbox"
                  aria-label={`${row.source.item.title} を登録する`}
                  checked={row.include}
                  disabled={disabled || !row.canInclude}
                  onChange={(event) => review.setInclude(key, event.target.checked)}
                />
              </td>
              <td>
                <div className="text-sm font-medium text-text-heading">{row.source.item.title}</div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 break-all text-left text-xs text-primary underline underline-offset-2"
                  onClick={() => void openEvidenceFile(row.source.evidence.storagePath).catch(() => undefined)}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  {row.source.evidence.fileName}
                </button>
                {row.source.item.planOrFuelName && (
                  <div className="text-xs text-text-muted">{row.source.item.planOrFuelName}</div>
                )}
              </td>
              <td>
                <select
                  aria-label="拠点"
                  className="gt-field h-8 text-xs"
                  value={row.values.locationId}
                  disabled={disabled}
                  onChange={(event) => review.setValue(key, { locationId: event.target.value })}
                >
                  <option value="" disabled>
                    拠点を選んでください
                  </option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="month"
                  aria-label="対象年月"
                  className="gt-field h-8 text-xs"
                  value={row.values.targetMonth}
                  disabled={disabled}
                  onChange={(event) => review.setValue(key, { targetMonth: event.target.value })}
                />
              </td>
              <td>
                <span className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="活動量"
                    className="gt-field h-8 w-28 text-right text-xs"
                    value={row.values.amount}
                    disabled={disabled}
                    onChange={(event) => review.setValue(key, { amount: normalizeAmountInput(event.target.value) })}
                  />
                  <span className="text-xs text-text-muted">{unit}</span>
                </span>
                {row.source.item.printedAmount && (
                  <span className="text-xs text-text-muted">請求書: {row.source.item.printedAmount}</span>
                )}
              </td>
              <td>
                <FactorCell row={row} review={review} disabled={disabled} />
              </td>
              <td className="gt-num text-sm">{formatEmissions(row.check.emissions)}</td>
              <td>
                <InvoiceJudgementBadge judgement={row.source.item.factor} />
                {[...(row.saveError ? [row.saveError] : []), ...row.check.errors].map((message) => (
                  <p key={message} className="text-xs text-danger">
                    {message}
                  </p>
                ))}
                {row.check.warnings.map((message) => (
                  <p key={message} className="text-xs text-warning">
                    {message}
                  </p>
                ))}
              </td>
              <td>
                <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onApply(review.prefillOf(row))}>
                  <ArrowDownToLine />
                  フォームで開く
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
