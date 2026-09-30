'use client';

// SSBJ レポートのプレビューの印刷ビュー（T12）。ブラウザの「印刷 → PDFとして保存」で PDF を出力する。
// 新規 PDF ライブラリを追加しない方針（AGENTS.md 技術スタック）に沿い、既存のレポート印刷ビュー
// （features/reports/components/ReportPrintView.client.tsx）と同じく window.print() と印刷用クラスを使う。
// 表示する内容（作業中 / 保存版）と内部メモの表示はクエリ（source / internal）で受け取る。

import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, Printer } from 'lucide-react';
import { useSsbjPreviewSource } from '../hooks/useSsbjPreviewSource';
import { parsePreviewSelection } from '../utils/preview';
import { SsbjPreviewDocument } from './SsbjPreviewDocument';

export const SsbjPreviewPrintView = ({ reportId }: { reportId: string }) => {
  const searchParams = useSearchParams();
  const sourceParam = searchParams.get('source');
  const selection = useMemo(() => parsePreviewSelection(sourceParam), [sourceParam]);
  const showInternalNotes = searchParams.get('internal') === '1';
  const { source, isLoading, errorMessage } = useSsbjPreviewSource(reportId, selection);
  // 読み込み完了後に一度だけ自動で印刷ダイアログを開くためのガード。
  const hasAutoPrinted = useRef(false);

  useEffect(() => {
    if (source && !hasAutoPrinted.current) {
      hasAutoPrinted.current = true;
      // レイアウト確定後に印刷ダイアログを開く。
      const timer = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(timer);
    }
  }, [source]);

  return (
    <div className="report-print-root">
      <div className="report-print-toolbar report-print-no-print">
        <span className="report-print-toolbar-title">SSBJ レポートのプレビュー</span>
        <button type="button" onClick={() => window.print()} disabled={!source} className="report-print-button">
          <Printer size={16} /> 印刷 / PDFとして保存
        </button>
      </div>

      {source && (
        <p className="report-print-hint report-print-no-print">
          きれいに出力するコツ: 印刷ダイアログで「背景のグラフィック」を有効に、「ヘッダーとフッター」を無効にしてください。用紙は A4 縦・倍率 100% を想定しています。
        </p>
      )}

      {isLoading && (
        <div className="report-print-status">
          <Loader2 size={20} className="animate-spin" />
          <span>プレビューを組み立てています...</span>
        </div>
      )}

      {errorMessage && !isLoading && (
        <div className="report-print-status report-print-error">
          <AlertCircle size={20} />
          <span>{errorMessage}</span>
        </div>
      )}

      {source && (
        <div className="report-print-page">
          <SsbjPreviewDocument source={source} showInternalNotes={showInternalNotes} />
        </div>
      )}
    </div>
  );
};
