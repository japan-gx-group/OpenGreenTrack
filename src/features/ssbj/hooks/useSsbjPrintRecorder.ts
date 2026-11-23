'use client';

// SSBJ レポートの印刷・PDF 保存を操作履歴に記録する（docs/ssbj-spec.md §13「操作履歴」）。
// 印刷はブラウザの機能（window.print()）で行うため、サーバーは実際に印刷・保存したかを知れない。記録するのは
// 「印刷のダイアログを開いた」時点で、ダイアログを取り消しても記録は残る（操作履歴の画面に注記する）。
//
// 経路は 2 つ:
//   - 画面の「印刷 / PDFとして保存」と、読み込み後の自動の印刷: 記録してから印刷のダイアログを開く。記録できなければ開かない
//     （CSV / Excel と同じく、誰がいつ出したかを残せない出力をさせないため）
//   - ブラウザのメニュー・Ctrl+P: 印刷を止める手段が無いため、beforeprint で記録を試みる。失敗したら画面に知らせる

import { useCallback, useEffect, useRef, useState } from 'react';
import { recordSsbjExport } from '../services/auditLogService';
import type { SsbjPreviewSource } from '../services/previewService';

/** 印刷する内容の版（作業中の内容なら null）。 */
const versionIdOf = (source: SsbjPreviewSource): string | null => (source.kind === 'version' ? source.versionId : null);

export const useSsbjPrintRecorder = (reportId: string, source: SsbjPreviewSource | null) => {
  const [errorMessage, setErrorMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  // 画面のボタンから開いた印刷の間は、beforeprint で二重に記録しない。
  const printingFromButton = useRef(false);

  const record = useCallback(async (target: SsbjPreviewSource) => {
    await recordSsbjExport(reportId, 'print', versionIdOf(target));
  }, [reportId]);

  /** 記録してから印刷のダイアログを開く。記録できなければ開かず、理由を errorMessage に出す。 */
  const print = useCallback(async () => {
    if (!source) return;
    setIsRecording(true);
    setErrorMessage('');
    try {
      await record(source);
    } catch {
      setErrorMessage('印刷の記録を操作履歴に保存できなかったため、印刷を中止しました。もう一度お試しください');
      return;
    } finally {
      setIsRecording(false);
    }
    printingFromButton.current = true;
    try {
      window.print();
    } finally {
      printingFromButton.current = false;
    }
  }, [record, source]);

  useEffect(() => {
    if (!source) return;
    const onBeforePrint = () => {
      if (printingFromButton.current) return;
      setErrorMessage('');
      record(source).catch(() => {
        setErrorMessage('ブラウザのメニューから開いた印刷を、操作履歴に記録できませんでした。画面の「印刷 / PDFとして保存」から印刷し直してください');
      });
    };
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, [record, source]);

  return { print, isRecording, errorMessage };
};
