// レポートのファイル出力（CSVダウンロード / 印刷用PDFビューのURL生成）。
// ブラウザ専用（Blob / document / window を使う）。Client Component からのみ呼ぶこと。
//
// CSV のエンコード・エスケープ（フォーミュラインジェクション対策含む）は共通ヘルパー
// `@/lib/files/csv` の downloadCsv に委ねる。このファイルは ReportDocument → 2次元配列への
// 変換（レイアウトと数値の丸め）にのみ責任を持つ。

import { downloadCsv } from '@/lib/files/csv';
import { timestampForFileName } from '@/lib/files/download';
import type { ReportCell, ReportDocument } from './reportContent';
import type { ReportTypeId } from './reportService';

// 数値は桁区切り無しでそのまま出し、Excel に数値として認識させる（過剰な小数は丸める）。
// 丸めは「レポートとして何桁見せるか」という表現上の判断のため、共通ヘルパーではなく
// この変換側に置く。
const roundNumericCell = (cell: ReportCell): ReportCell =>
  typeof cell === 'number' ? Number(cell.toFixed(3)) : cell;

// ReportDocument を CSV 出力用の2次元配列（先頭行はタイトル、空行はセクション区切り）へ変換する。
export const documentToRows = (reportDocument: ReportDocument): ReportCell[][] => {
  const rows: ReportCell[][] = [];
  rows.push([reportDocument.documentTitle]);
  reportDocument.meta.forEach(item => rows.push([item.label, item.value]));
  rows.push([]);

  reportDocument.sections.forEach((section, index) => {
    if (index > 0) rows.push([]);
    rows.push([section.heading]);
    if (section.note) rows.push([section.note]);
    rows.push([...section.columns]);
    section.rows.forEach(row => rows.push(row.map(roundNumericCell)));
  });

  return rows;
};

export const buildReportFileName = (reportDocument: ReportDocument, extension: string): string => {
  // ファイル名に使えない文字を除去し、日時を付けて衝突を避ける。
  const base = reportDocument.documentTitle.replace(/[\\/:*?"<>|]/g, '_');
  return `${base}_${timestampForFileName(reportDocument.generatedAt)}.${extension}`;
};

// 引数名はグローバル document とのシャドーイングを避けて reportDocument とする。
// エンコードは共通ヘルパー（UTF-16LE + BOM + タブ区切り）に統一し、Mac 版 Excel でも
// 文字化けしないようにする。
export const downloadReportCsv = (reportDocument: ReportDocument): void => {
  downloadCsv(buildReportFileName(reportDocument, 'csv'), documentToRows(reportDocument));
};

// 印刷用PDFビュー（/reports/print）へのURL。生成条件をクエリで渡し、ビュー側で再取得・整形する。
export const buildReportPrintUrl = (input: {
  reportType: ReportTypeId;
  fiscalYearId: string;
  locationIds: string[];
}): string => {
  const params = new URLSearchParams({
    type: input.reportType,
    fiscalYearId: input.fiscalYearId,
  });
  // 拠点選択を使わない種別（Scope 3 詳細）は拠点を渡さない。
  if (input.locationIds.length > 0) {
    params.set('locations', input.locationIds.join(','));
  }
  return `/reports/print?${params.toString()}`;
};

/** ポップアップブロック時にユーザーへ案内する文言。 */
export const POPUP_BLOCKED_MESSAGE =
  'ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してください。';

// 印刷用PDFビューを新規タブで開き、実際に開けたかどうかを返す。
// window.open に 'noopener' を渡すと仕様上ブロック時と同じく null が返り、開けたかどうかを
// 判別できない。そのため features は渡さず、開けた場合に opener を切って同等の状態にする
// （印刷ビューは同一オリジンなので opener の書き換えは常に可能）。
export const openReportPrintView = (input: Parameters<typeof buildReportPrintUrl>[0]): boolean => {
  const opened = window.open(buildReportPrintUrl(input), '_blank');
  if (!opened) return false;
  opened.opener = null;
  return true;
};
