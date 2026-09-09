'use client';

// 印刷用PDFビュー。ブラウザの「印刷 → PDFとして保存」で高精細のレポートPDFを出力する。
// 新規PDFライブラリを追加しない方針（AGENTS.md 技術スタック）に沿い、window.print() を用いる。
// 生成条件はクエリ（type / fiscalYearId / locations）で受け取り、共通ビルダーで本文を組み立てる。

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Printer, AlertCircle } from 'lucide-react';
import {
  buildReportDocument,
  formatCellForDisplay,
  isNumericCell,
  type ReportDocument,
} from '../services/reportContent';
import { REPORT_TYPE_LABELS, isReportTypeId, usesLocationFilter } from '../types';

export const ReportPrintView = () => {
  const searchParams = useSearchParams();
  // グローバル document とのシャドーイングを避けるため reportDocument と命名する。
  const [reportDocument, setReportDocument] = useState<ReportDocument | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // 読み込み完了後に一度だけ自動で印刷ダイアログを開くためのガード。
  const hasAutoPrinted = useRef(false);

  const params = useMemo(() => {
    const type = searchParams.get('type');
    const fiscalYearId = searchParams.get('fiscalYearId');
    const locations = searchParams.get('locations');
    return {
      type,
      fiscalYearId,
      locationIds: locations ? locations.split(',').filter(Boolean) : [],
    };
  }, [searchParams]);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      // 拠点選択を使わない種別（Scope 3 詳細）は拠点未指定でも有効な条件とみなす。
      if (
        !params.type
        || !isReportTypeId(params.type)
        || !params.fiscalYearId
        || (usesLocationFilter(params.type) && params.locationIds.length === 0)
      ) {
        if (isMounted) {
          setErrorMessage('レポートの出力条件が不正です。レポート画面から再度出力してください。');
          setIsLoading(false);
        }
        return;
      }

      try {
        const result = await buildReportDocument({
          reportType: params.type,
          reportTypeLabel: REPORT_TYPE_LABELS[params.type],
          fiscalYearId: params.fiscalYearId,
          format: 'pdf',
          locationIds: params.locationIds,
        });
        if (isMounted) {
          setReportDocument(result);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'レポートの生成に失敗しました');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [params]);

  useEffect(() => {
    if (reportDocument && !hasAutoPrinted.current) {
      hasAutoPrinted.current = true;
      // レイアウト確定後に印刷ダイアログを開く。
      const timer = window.setTimeout(() => window.print(), 300);
      return () => window.clearTimeout(timer);
    }
  }, [reportDocument]);

  return (
    <div className="report-print-root">
      <div className="report-print-toolbar report-print-no-print">
        <span className="report-print-toolbar-title">レポートプレビュー</span>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!reportDocument}
          className="report-print-button"
        >
          <Printer size={16} /> 印刷 / PDFとして保存
        </button>
      </div>

      {/* 出力品質はブラウザの印刷設定に依存するため、推奨設定を画面上で案内する
          （Chrome 系は配色を CSS 側で強制できるが、他ブラウザや古い環境では設定依存が残る）。
          読み込み中・エラー時は印刷対象がなく案内が紛らわしいため、生成成功時のみ出す。 */}
      {reportDocument && (
        <p className="report-print-hint report-print-no-print">
          きれいに出力するコツ: 印刷ダイアログで「背景のグラフィック」を有効に、「ヘッダーとフッター」を無効にしてください。用紙は A4 縦・倍率 100% を想定しています。
        </p>
      )}

      {isLoading && (
        <div className="report-print-status">
          <Loader2 size={20} className="animate-spin" />
          <span>レポートを生成しています...</span>
        </div>
      )}

      {errorMessage && !isLoading && (
        <div className="report-print-status report-print-error">
          <AlertCircle size={20} />
          <span>{errorMessage}</span>
        </div>
      )}

      {reportDocument && (
        <article className="report-print-page">
          <header className="report-print-header">
            <h1 className="report-print-title">{reportDocument.documentTitle}</h1>
            <dl className="report-print-meta">
              {reportDocument.meta.map(item => (
                <div key={item.label} className="report-print-meta-item">
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </header>

          {reportDocument.sections.map(section => (
            <section key={section.heading} className="report-print-section">
              <h2 className="report-print-section-heading">{section.heading}</h2>
              {section.note && <p className="report-print-note">{section.note}</p>}
              <table className="report-print-table">
                <thead>
                  <tr>
                    {section.columns.map((column, index) => (
                      <th key={column} className={index === 0 ? 'report-print-th-left' : undefined}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.length > 0 ? (
                    section.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={isNumericCell(cell) ? 'report-print-td-num' : undefined}
                          >
                            {formatCellForDisplay(cell)}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={section.columns.length} className="report-print-empty">
                        データがありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          ))}

          <footer className="report-print-footer">
            GreenTrack — GHG排出量算定レポート / 出力日時: {reportDocument.meta.find(item => item.label === '出力日時')?.value ?? '-'}
          </footer>
        </article>
      )}
    </div>
  );
};
