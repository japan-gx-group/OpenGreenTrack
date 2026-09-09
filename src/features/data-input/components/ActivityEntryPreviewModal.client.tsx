'use client';

// 入力内容の確認モーダル。行の内容は services/entryFormat.ts の buildPreviewRows が決める。
// E2E は .modal-content と見出し「入力内容の確認」、#manual-save-button を参照する。
// 本文は .modal-body（globals.css の @layer components で 2 カラム grid になる）を使わず、自前の縦並びラッパにする。

import React, { useEffect, useRef } from 'react';
import { Check, ClipboardList, X } from 'lucide-react';
import type { EntryMode } from '../services/entryCategory';
import type { PreviewRow } from '../services/entryFormat';

export interface ActivityEntryPreviewModalProps {
  mode: EntryMode;
  rows: PreviewRow[];
  /** 表の直下に出す注意（例: 保存されていた係数が適用できない）。null なら非表示 */
  caution: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: () => void;
}

export const ActivityEntryPreviewModal = ({
  mode,
  rows,
  caution,
  isSaving,
  onClose,
  onSave,
}: ActivityEntryPreviewModalProps) => {
  const isEdit = mode === 'edit';
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  // 開いたら確定ボタンへフォーカスを移し、Escape で閉じる（背後のフォームにフォーカスが残らないようにする）。
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

  return (
    <div className="modal-overlay">
      {/* .modal-content の max-width(1200px) は層外定義でユーティリティが効かないため、幅は style で指定する。 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-preview-title"
        className="modal-content w-full"
        style={{ maxWidth: '48rem' }}
      >
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-primary" />
            <h2 id="manual-preview-title" className="text-lg font-serif font-semibold">
              {isEdit ? '変更内容の確認' : '入力内容の確認'}
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
            {isEdit
              ? '以下の内容で活動量レコードを更新します。保存後に排出量を再計算します。'
              : '以下の内容で活動量レコードを登録します。内容を確認してください。'}
          </p>

          <div className="overflow-hidden rounded-md border border-primary bg-primary-light">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={`grid grid-cols-[8rem_1fr] gap-2 px-4 py-2.5 text-sm ${
                  index < rows.length - 1 ? 'border-b border-primary' : ''
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

          {caution && <p className="text-sm text-warning">{caution}</p>}
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
            id="manual-save-button"
            ref={saveButtonRef}
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="gt-btn-primary min-w-36 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={18} className="mr-1" />
            {isSaving ? '保存中...' : isEdit ? '更新を保存' : '確定保存'}
          </button>
        </div>
      </div>
    </div>
  );
};
