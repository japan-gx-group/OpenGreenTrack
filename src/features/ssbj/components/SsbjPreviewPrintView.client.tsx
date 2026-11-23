'use client';

// SSBJ レポートのプレビューの印刷ビュー（T12）。ブラウザの「印刷 → PDFとして保存」で PDF を出力する。
// 新規 PDF ライブラリを追加しない方針（AGENTS.md 技術スタック）に沿い、既存のレポート印刷ビュー
// （features/reports/components/ReportPrintView.client.tsx）と同じく window.print() と印刷用クラスを使う。
// 表示する内容（作業中 / 保存版）はクエリ（source）で受け取る。
// 印刷・PDF は社外に共有されうるため、内部メモと根拠文書の内部記録（開示しない内容）は常に出さない。
// クエリに internal=1 などが付いていても読まない（URL を直接開いても内部情報が印刷に混ざらないようにする）。
// このタブの「印刷 / PDFとして保存」を選ぶたびに、表示している版と一緒に操作履歴に記録する（hooks/useSsbjPrintRecorder.ts）。
// 開いた直後の自動の印刷は、プレビューで選んだ操作の続きのため記録しない（プレビュー側で記録済み）。
// 閲覧者は、クエリにかかわらず承認した保存版の開示する内容（内部メモ・内部記録を除いたもの）を API から読む
// （閲覧者は保存版の行を読めない。docs/authorization-matrix.md §2.3）。

import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, Printer } from 'lucide-react';
import { useSsbjApprovedVersion } from '../hooks/useSsbjApprovedVersion';
import { useSsbjMyRole } from '../hooks/useSsbjMyRole';
import { useSsbjPreviewSource } from '../hooks/useSsbjPreviewSource';
import { useSsbjPrintRecorder } from '../hooks/useSsbjPrintRecorder';
import type { SsbjPreviewSource } from '../services/previewService';
import { canViewSsbjWorking } from '../utils/memberRole';
import { parsePreviewSelection } from '../utils/preview';
import { SsbjPreviewDocument } from './SsbjPreviewDocument';

/** 印刷する内容の版（作業中の内容なら null）。 */
const versionIdOf = (source: SsbjPreviewSource): string | null => (source.kind === 'version' ? source.versionId : null);

export const SsbjPreviewPrintView = ({ reportId }: { reportId: string }) => {
  const searchParams = useSearchParams();
  const sourceParam = searchParams.get('source');
  const selection = useMemo(() => parsePreviewSelection(sourceParam), [sourceParam]);
  // ロールが分かるまではどちらも読まない。
  const myRole = useSsbjMyRole();
  const roleKnown = !myRole.isLoading;
  const viewerOnly = roleKnown && !canViewSsbjWorking(myRole.role);
  const working = useSsbjPreviewSource(roleKnown && !viewerOnly ? reportId : null, selection);
  const approved = useSsbjApprovedVersion(viewerOnly ? reportId : null);
  const { source, errorMessage } = viewerOnly ? approved : working;
  const isLoading = !roleKnown || (viewerOnly ? approved.isLoading : working.isLoading);
  const printer = useSsbjPrintRecorder(reportId);
  const { recordSelection } = printer;
  // 読み込み完了後に一度だけ自動で印刷ダイアログを開くためのガード。
  const hasAutoPrinted = useRef(false);

  useEffect(() => {
    if (source && !hasAutoPrinted.current) {
      hasAutoPrinted.current = true;
      // レイアウト確定後に印刷ダイアログを開く（記録はプレビューで選んだ時点で済んでいる）。
      const timer = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(timer);
    }
  }, [source]);

  // 記録を試みてから印刷ダイアログを開く。記録できなくても印刷は続ける（失敗は画面で知らせる）。
  const printAgain = async (shown: SsbjPreviewSource) => {
    await recordSelection(versionIdOf(shown));
    window.print();
  };

  return (
    <div className="report-print-root">
      <div className="report-print-toolbar report-print-no-print">
        <span className="report-print-toolbar-title">SSBJ レポートのプレビュー</span>
        <button type="button" onClick={() => { if (source) void printAgain(source); }} disabled={!source} className="report-print-button">
          <Printer size={16} /> 印刷 / PDFとして保存
        </button>
      </div>

      {printer.errorMessage && (
        <div role="alert" className="report-print-status report-print-error report-print-no-print">
          <AlertCircle size={20} />
          <span>{printer.errorMessage}</span>
        </div>
      )}

      {source && (
        <p className="report-print-hint report-print-no-print">
          きれいに出力するコツ: 印刷ダイアログで「背景のグラフィック」を有効に、「ヘッダーとフッター」を無効にしてください。用紙は A4 縦・倍率 100% を想定しています。
          「印刷 / PDFとして保存」を選ぶと、表示している版と一緒に操作履歴に記録されます（印刷を取り消しても記録は残ります）。
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
          <SsbjPreviewDocument source={source} showInternalNotes={false} />
        </div>
      )}
    </div>
  );
};
