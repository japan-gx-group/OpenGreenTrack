'use client';

// 一括入力（複数月まとめて入力）の確認モーダル。共通条件（拠点・カテゴリなど）は
// 単月入力の確認モーダルと同じ行形式で、月ごとの内容（活動量・適用係数・推定排出量）は
// 表で見せる。表示内容は services/bulkEntry.ts の buildBulkPreview が決める。

import React, { useEffect, useRef } from 'react';
import { Check, ClipboardList, X } from 'lucide-react';
import type { BulkPreview } from '../services/bulkEntry';
import type { PreviewRow } from '../services/entryFormat';

export interface BulkEntryPreviewModalProps {
  /** 共通条件の行（拠点・カテゴリ・係数の参照方式・備考）。単月入力の確認モーダルと同じ形式 */
  summaryRows: PreviewRow[];
  preview: BulkPreview;
  isSaving: boolean;
  onClose: () => void;
  onSave: () => void;
}

export const BulkEntryPreviewModal = ({
  summaryRows,
  preview,
  isSaving,
  onClose,
  onSave,
}: BulkEntryPreviewModalProps) => {
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  // 開いたら確定ボタンへフォーカスを移し、Escape で閉じる（単月入力の確認モーダルと同じ挙動）。
  useEffect(() => {
    saveButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const summary = [
    preview.createCount > 0 ? `新規登録 ${preview.createCount}件` : null,
    preview.overwriteCount > 0 ? `上書き ${preview.overwriteCount}件` : null,
  ]
    .filter((part) => part !== null)
    .join('・');

  return (
    <div className="modal-overlay">
      {/* .modal-content の max-width(1200px) は層外定義でユーティリティが効かないため、幅は style で指定する。 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-bulk-preview-title"
        className="modal-content w-full"
        style={{ maxWidth: '56rem' }}
      >
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-primary" />
            <h2 id="manual-bulk-preview-title" className="text-lg font-serif font-semibold">
              一括入力内容の確認
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-main"
            aria-label="閉じる"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
          <p className="text-sm text-text-muted">
            以下の内容で{summary}の活動量レコードを保存します。内容を確認してください。
          </p>

          <div className="overflow-hidden rounded-md border border-primary bg-primary-light">
            {summaryRows.map((row, index) => (
              <div
                key={row.label}
                className={`grid grid-cols-[8rem_1fr] gap-2 px-4 py-2.5 text-sm ${
                  index < summaryRows.length - 1 ? 'border-b border-primary' : ''
                }`}
              >
                <span className="font-medium text-text-muted">{row.label}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold text-text-main">{row.value}</span>
                  {row.note && <span className="text-xs text-text-muted">{row.note}</span>}
                </span>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-border-light">
            <table className="w-full text-sm" data-testid="manual-bulk-preview-table">
              <thead>
                <tr className="border-b border-border-light bg-gray-50 text-left text-xs text-text-muted">
                  <th className="px-3 py-2 font-medium">対象年月</th>
                  <th className="px-3 py-2 font-medium">区分</th>
                  <th className="px-3 py-2 font-medium">活動量</th>
                  <th className="px-3 py-2 font-medium">適用係数</th>
                  <th className="px-3 py-2 text-right font-medium">推定排出量（t-CO2e）</th>
                </tr>
              </thead>
              <tbody>
                {preview.monthRows.map((row) => (
                  <React.Fragment key={row.month}>
                    <tr className="border-b border-border-light last:border-b-0">
                      <td className="px-3 py-2 font-medium text-text-main">{row.label}</td>
                      <td className="px-3 py-2 text-text-muted">{row.actionLabel}</td>
                      <td className="px-3 py-2">{row.amountText}</td>
                      <td className="px-3 py-2 text-text-muted">{row.factorText ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.emissionsText}</td>
                    </tr>
                    {row.warning && (
                      <tr className="border-b border-border-light last:border-b-0">
                        <td />
                        <td colSpan={4} className="px-3 pb-2 text-xs text-warning">
                          {row.warning}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-light bg-gray-50">
                  <td colSpan={4} className="px-3 py-2 text-right text-xs font-medium text-text-muted">
                    推定排出量の合計
                  </td>
                  <td className="px-3 py-2 text-right font-semibold" data-testid="manual-bulk-preview-total">
                    {preview.totalEmissionsText}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="gt-btn min-w-28 disabled:cursor-not-allowed disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            id="manual-bulk-save-button"
            ref={saveButtonRef}
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="gt-btn-primary min-w-36 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={18} className="mr-1" />
            {isSaving ? '保存中...' : '確定保存'}
          </button>
        </div>
      </div>
    </div>
  );
};
