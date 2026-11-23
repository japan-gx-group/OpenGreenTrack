'use client';

// SSBJ レポートの印刷・PDF 保存を操作履歴に記録する（docs/ssbj-spec.md §13「印刷・PDF 保存の記録（R2-45）」）。
// 記録するのは、利用者が「印刷・PDFとして保存」のボタンを選んだ時点（操作者・時刻・レポート・保存版なら版）。
// 印刷はブラウザの機能（window.print()）で行うため、実際に印刷・保存したかは分からない。
//
// 記録する場面:
//   - プレビューの「印刷・PDFとして保存」: 印刷用のタブを開くのと同時に記録する（印刷用のタブで読み込みに失敗しても残る）
//   - 印刷用のタブの「印刷 / PDFとして保存」: 選ぶたびに 1 件記録する
// 記録しない場面: プレビューで選んだ後に続く自動の印刷（同じ選択の続き）、ブラウザのメニュー・Ctrl+P からの印刷。
// CSV / Excel と違い、記録できなくても印刷・PDF 保存は止めない（画面で知らせる）。

import { useCallback, useState } from 'react';
import { recordSsbjExport } from '../services/auditLogService';

export const PRINT_RECORD_FAILED_MESSAGE =
  '「印刷・PDFとして保存」を選んだことを操作履歴に保存できませんでした。印刷・PDF 保存はそのまま続けられます（この操作は履歴に残っていません）';

export const useSsbjPrintRecorder = (reportId: string) => {
  const [errorMessage, setErrorMessage] = useState('');

  /** ボタンを選んだことを記録する（作業中の内容なら versionId は null）。失敗しても例外にせず、errorMessage で知らせる。 */
  const recordSelection = useCallback(async (versionId: string | null): Promise<void> => {
    setErrorMessage('');
    try {
      await recordSsbjExport(reportId, 'print', versionId);
    } catch {
      setErrorMessage(PRINT_RECORD_FAILED_MESSAGE);
    }
  }, [reportId]);

  return { recordSelection, errorMessage };
};
