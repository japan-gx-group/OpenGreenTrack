import { describe, expect, it } from 'vitest';
import { fictionalVersion } from '../../__fixtures__/fictionalReport';
import { ssbjVersionToCsvRows } from '../versionCsv';
import { buildSsbjWorkbook, ssbjVersionSheet, ssbjVersionXlsxFileName } from '../versionXlsx';

// Excel の中身（値・見出しの書式・画面の固定）を、ファイルにする前のブックで確かめる（exceljs は実物を使う）。
const GENERATED_AT = '2025-06-04T01:02:03.000Z';

describe('保存版の Excel', () => {
  it('CSV と同じ行をそのまま書き、見出しの行を太字にしてその下で画面を固定する', async () => {
    const rows = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    const sheet = ssbjVersionSheet(rows);
    expect(rows[sheet.headerRowIndex!]).toEqual(['章', '対象ID', '項目', '状態', '開示内容', '単位', '内部記録', '注記']);

    const workbook = await buildSsbjWorkbook([sheet]);
    const worksheet = workbook.getWorksheet('SSBJレポート')!;
    expect(worksheet.rowCount).toBe(rows.length);
    rows.forEach((cells, index) => {
      const values = cells.map((_, column) => worksheet.getRow(index + 1).getCell(column + 1).value ?? '');
      expect(values, `行 ${index + 1}`).toEqual(cells);
    });
    expect(worksheet.getRow(sheet.headerRowIndex! + 1).font?.bold).toBe(true);
    expect(worksheet.views[0]).toMatchObject({ state: 'frozen', ySplit: sheet.headerRowIndex! + 1 });
  });

  it('数式に見える文字列も文字列のまま書く（数式として評価させない）', async () => {
    const workbook = await buildSsbjWorkbook([{
      name: 's', rows: [['=1+1', '@SUM(A1)']], headerRowIndex: null, columnWidths: [10, 10], wrapColumns: [],
    }]);
    const row = workbook.getWorksheet('s')!.getRow(1);
    expect(row.getCell(1).value).toBe('=1+1');
    expect(row.getCell(1).type).toBe(3); // ValueType.String
    expect(row.getCell(2).value).toBe('@SUM(A1)');
  });

  it('ファイル名に版番号と日時を入れる', () => {
    expect(ssbjVersionXlsxFileName(fictionalVersion, GENERATED_AT)).toMatch(/^SSBJ_社内確認用_版1_\d{8}-\d{4}\.xlsx$/);
  });
});
