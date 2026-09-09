'use client';

// 拠点一覧カードの見出しと操作ボタン（CSV テンプレート / CSV エクスポート / CSV インポート / 新規追加）。
// CSV インポートのファイル選択は hidden input で行い、ボタンから click() で開く。

import { useRef } from 'react';
import { Download, FileDown, Plus, Upload } from 'lucide-react';

interface LocationToolbarProps {
  onDownloadTemplate: () => void;
  onExportCsv: () => void;
  onSelectImportFile: (file: File) => void;
  onCreate: () => void;
}

export const LocationToolbar = ({
  onDownloadTemplate,
  onExportCsv,
  onSelectImportFile,
  onCreate,
}: LocationToolbarProps) => {
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="gt-card-head">
      <div>
        <h2 className="gt-card-title">拠点一覧</h2>
        <p className="gt-card-sub">行をクリックするとその拠点の Scope 内訳を表示します</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* 新規一括登録の出発点。記入例つきで、選択肢のある列に何を書くかがファイル単体で分かる。 */}
        <button
          type="button"
          className="gt-btn"
          onClick={onDownloadTemplate}
          title="インポート用の記入例つきCSVを取得します"
        >
          <FileDown size={15}/> CSVテンプレート
        </button>
        <button type="button" className="gt-btn" onClick={onExportCsv}>
          <Download size={15}/> CSVエクスポート
        </button>
        {/* テンプレート／エクスポートと同じ列構成のCSVを取り込む（追加・更新・スキップを自動判定） */}
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
          title="CSVテンプレート／CSVエクスポートと同じ列構成のファイルを取り込みます（取り込む前に内容を確認できます）"
        >
          <Upload size={15}/> CSVインポート
        </button>
        <button type="button" className="gt-btn-primary" onClick={onCreate}>
          <Plus size={15}/> 新規拠点を追加
        </button>
      </div>
    </div>
  );
};
