'use client';

// CSVインポートの行単位エラー一覧（行番号つき）。トーストでは件数のみ通知するため、内訳はここで見せる。
// 拠点・排出係数など取込を持つ画面で共通に使う。errors が空なら何も描画しない。

import { AlertCircle, X } from 'lucide-react';
import clsx from 'clsx';

export interface CsvImportRowError {
  row: number;
  reasons: string[];
}

interface CsvImportErrorPanelProps {
  errors: CsvImportRowError[];
  onClose: () => void;
  /** 親のレイアウトに合わせた余白（例: 'mb-2'） */
  className?: string;
}

export const CsvImportErrorPanel = ({ errors, onClose, className }: CsvImportErrorPanelProps) => {
  if (errors.length === 0) return null;

  return (
    <div className={clsx('rounded-md border border-danger bg-danger-light px-4 py-3', className)}>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle size={16} />
          <span className="text-sm font-semibold">CSVインポートで取り込めなかった行があります（{errors.length}件）</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-main"
          title="エラー一覧を閉じる"
        >
          <X size={16} />
        </button>
      </div>
      <ul className="text-xs text-text-main flex flex-col gap-1 max-h-40 overflow-y-auto">
        {errors.map((error, index) => (
          <li key={`${error.row}-${index}`}>行 {error.row}: {error.reasons.join('、')}</li>
        ))}
      </ul>
    </div>
  );
};
