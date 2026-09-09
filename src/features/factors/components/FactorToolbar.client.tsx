'use client';

// 排出係数一覧カードの見出しと操作ボタン（絞り込みリセット / CSV エクスポート / CSV インポート / 新規追加）。
// CSV インポートのファイル選択は hidden input で行い、ボタンから click() で開く。

import { useRef } from 'react';
import { Download, Plus, RefreshCw, Upload } from 'lucide-react';

interface FactorToolbarProps {
  /** 絞り込み後の件数 */
  displayCount: number;
  onResetFilters: () => void;
  onExportCsv: () => void;
  onSelectImportFile: (file: File) => void;
  onCreate: () => void;
}

export const FactorToolbar = ({
  displayCount,
  onResetFilters,
  onExportCsv,
  onSelectImportFile,
  onCreate,
}: FactorToolbarProps) => {
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="gt-card-head">
      <div>
        <h2 className="gt-card-title">排出係数一覧</h2>
        {/* 群ごとの登録件数はタブのバッジが持つため、ここは絞り込み後の件数だけを出す。 */}
        <p className="gt-card-sub">
          {displayCount} 件を表示中
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="gt-btn" onClick={onResetFilters} title="すべての検索とフィルター設定を初期状態に戻します">
          <RefreshCw size={15}/> フィルターをリセット
        </button>
        <button
          type="button"
          className="gt-btn"
          onClick={onExportCsv}
          title="表示中のタブと絞り込み条件に一致する係数をCSVに書き出します"
        >
          <Download size={15}/> CSVエクスポート
        </button>
        {/* エクスポートと同じ列構成のCSVを取り込む（追加・更新・スキップを自動判定） */}
        <input
          ref={importFileInputRef}
          type="file"
          accept=".csv,text/csv,text/tab-separated-values"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // 同じファイルを続けて選び直せるよう毎回リセットする
            e.target.value = '';
            if (file) onSelectImportFile(file);
          }}
        />
        <button
          type="button"
          className="gt-btn"
          onClick={() => importFileInputRef.current?.click()}
          title="CSVエクスポートと同じ列構成のファイルを取り込みます（取り込む前に内容を確認できます）"
        >
          <Upload size={15}/> CSVインポート
        </button>
        <button type="button" className="gt-btn-primary" onClick={onCreate}>
          <Plus size={15}/> 新規係数を追加
        </button>
      </div>
    </div>
  );
};
