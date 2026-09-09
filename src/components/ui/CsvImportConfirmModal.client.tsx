'use client';

// CSVインポートの実行確認モーダル。
// 取込は既存データの更新を含み取り消せないため、DBへ書く前に
// 「何件追加され、どのデータが上書きされ、どの行が取り込めないか」を見せる。
// 拠点管理・排出係数マスタで同じ導線にするためここに置く。
//
// 件数と上書き対象の判定は各機能の取込プラン（DBに触らない純関数）が済ませている前提で、
// このコンポーネントは受け取った内容を表示するだけ。

import React from 'react';
import { Modal } from '@/components/ui/Modal.client';

export interface CsvImportConfirmSummary {
  fileName: string;
  createCount: number;
  skipCount: number;
  /** 上書きされる既存データ。label は「何が上書きされるか」の表示名（改名なら「旧名 → 新名」） */
  updates: { row: number; label: string }[];
  /** 取り込めない行（行番号と理由） */
  errors: { row: number; reasons: string[] }[];
  /**
   * 件数には現れない補足（例: テンプレートの記入例行を除外した旨）。
   * エラーではないので danger ではなく控えめに出す。
   */
  notes?: string[];
}

export interface CsvImportConfirmModalProps {
  summary: CsvImportConfirmSummary | null;
  /** 取込対象の呼び方（例: '拠点' / '排出係数'）。警告文に使う */
  entityLabel: string;
  isRunning: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const CsvImportConfirmModal = ({
  summary,
  entityLabel,
  isRunning,
  onCancel,
  onConfirm,
}: CsvImportConfirmModalProps) => (
  <Modal isOpen={summary !== null} onClose={onCancel} title="CSVインポートの確認" size="lg">
    {summary && (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          <span className="font-medium text-text-main">{summary.fileName}</span> を読み取りました。
          内容を確認して取り込んでください。
        </p>

        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '新規追加', value: summary.createCount, tone: 'text-primary' },
            { label: '更新', value: summary.updates.length, tone: 'text-warning' },
            { label: '変更なし', value: summary.skipCount, tone: 'text-text-muted' },
            { label: '取り込めない行', value: summary.errors.length, tone: 'text-danger' },
          ].map(item => (
            <div key={item.label} className="rounded-md border border-border-light bg-bg-main px-3 py-2">
              <div className="text-xs text-text-muted">{item.label}</div>
              <div className={`font-serif text-2xl font-semibold ${item.tone}`}>{item.value}</div>
            </div>
          ))}
        </div>

        {summary.updates.length > 0 && (
          <div className="rounded-md border border-warning bg-warning/10 px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-warning">
              次の{summary.updates.length}件は既存の{entityLabel}を上書きします（元に戻せません）
            </p>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs text-text-main">
              {summary.updates.map(update => (
                <li key={update.row}>行 {update.row}: {update.label}</li>
              ))}
            </ul>
          </div>
        )}

        {summary.notes && summary.notes.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-border-light bg-bg-main px-4 py-3 text-xs text-text-muted">
            {summary.notes.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        {summary.errors.length > 0 && (
          <div className="rounded-md border border-danger bg-danger-light px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-danger">
              次の{summary.errors.length}行は取り込まれません（他の行はそのまま取り込めます）
            </p>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs text-text-main">
              {summary.errors.map((error, index) => (
                <li key={`${error.row}-${index}`}>行 {error.row}: {error.reasons.join('、')}</li>
              ))}
            </ul>
          </div>
        )}

        {summary.createCount + summary.updates.length === 0 && (
          <p className="text-sm text-text-muted">
            反映する変更がありません。ファイルの内容を確認してください。
          </p>
        )}

        <div className="mt-2 flex justify-end gap-3 border-t border-border-light pt-4">
          <button type="button" className="gt-btn" onClick={onCancel} disabled={isRunning}>
            キャンセル
          </button>
          <button
            type="button"
            className="gt-btn-primary"
            onClick={onConfirm}
            disabled={isRunning || summary.createCount + summary.updates.length === 0}
          >
            {isRunning
              ? '取り込み中...'
              : `${summary.createCount + summary.updates.length}件を取り込む`}
          </button>
        </div>
      </div>
    )}
  </Modal>
);
