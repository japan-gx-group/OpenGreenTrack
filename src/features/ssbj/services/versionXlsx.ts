// SSBJ の出力を Excel（.xlsx）にする。保存版の出力は CSV と同じ行（versionCsv.ts の ssbjVersionToCsvRows）から作り、
// 内容を CSV と一致させる（Excel だけの項目を足さない）。操作履歴の出力（utils/auditLog.ts の行）にも使う。
//
// exceljs は既存の依存（OGT 本体の IDEA 取込で使用）。画面の初回読み込みを重くしないよう、出力するときだけ読み込む。
// 文字列は文字列のセルとして書くため、= などで始まる値も数式として評価されない（CSV の数式対策と同じ目的）。

import type { Workbook } from 'exceljs';
import { downloadBlob, timestampForFileName } from '@/lib/files/download';
import type { SsbjCsvVersion } from './versionCsv';

export type SsbjXlsxSheet = {
  name: string;
  rows: string[][];
  /** 見出しの行（0 始まり）。太字・背景色を付け、その下で画面を固定する。 */
  headerRowIndex: number | null;
  /** 列の幅（文字数）。 */
  columnWidths: number[];
  /** 折り返して表示する列（0 始まり）。長い文章の列。 */
  wrapColumns: number[];
};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const loadExcelJs = async () => (await import('exceljs')).default;

/** シートを並べたブックを作る（テストから中身を確かめられるよう、ファイルにする前の形で返す）。 */
export const buildSsbjWorkbook = async (sheets: SsbjXlsxSheet[]): Promise<Workbook> => {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OpenGreenTrack SSBJ（試行版）';
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    worksheet.columns = sheet.columnWidths.map(width => ({ width }));
    sheet.rows.forEach((cells, index) => {
      const row = worksheet.addRow(cells);
      if (index === sheet.headerRowIndex) {
        row.font = { bold: true };
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3EC' } };
        });
      }
      for (const column of sheet.wrapColumns) {
        row.getCell(column + 1).alignment = { wrapText: true, vertical: 'top' };
      }
    });
    if (sheet.headerRowIndex !== null) {
      worksheet.views = [{ state: 'frozen', ySplit: sheet.headerRowIndex + 1 }];
    }
  }
  return workbook;
};

/** ブックを .xlsx としてダウンロードさせる（ブラウザからのみ呼ぶ）。 */
export const downloadSsbjWorkbook = async (workbook: Workbook, fileName: string): Promise<void> => {
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: XLSX_MIME }), fileName);
};

// 保存版の CSV の列（章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記）に合わせた幅と折り返し。
const VERSION_COLUMN_WIDTHS = [20, 34, 30, 14, 60, 10, 44, 44];
const VERSION_WRAP_COLUMNS = [2, 4, 6, 7];

/** 保存版の CSV の行から、Excel のシートを作る（見出しの行は「章」で始まる行）。 */
export const ssbjVersionSheet = (rows: string[][]): SsbjXlsxSheet => {
  const headerIndex = rows.findIndex(row => row[0] === '章' && row[1] === '対象ID');
  return {
    name: 'SSBJレポート',
    rows,
    headerRowIndex: headerIndex >= 0 ? headerIndex : null,
    columnWidths: VERSION_COLUMN_WIDTHS,
    wrapColumns: VERSION_WRAP_COLUMNS,
  };
};

export const ssbjVersionXlsxFileName = (version: Pick<SsbjCsvVersion, 'versionNumber'>, generatedAt: string): string =>
  `SSBJ_社内確認用_版${version.versionNumber}_${timestampForFileName(generatedAt)}.xlsx`;
