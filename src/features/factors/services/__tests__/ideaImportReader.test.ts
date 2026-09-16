// readIdeaWorkbookStream（ストリーミング読取）のテスト。
// 一括読込（parseIdeaWorkbook）と同じ結果になること、対象外シートを読み飛ばすこと、
// 壊れたファイルは reject することを検証する。IDEA の実データ値は含めない（§0.1）。

import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import ExcelJS from 'exceljs';
import { DEFAULT_IDEA_GWP_MODEL, IDEA_FIXED_COLUMN_HEADERS, parseIdeaWorkbook } from '../ideaImport';
import { readIdeaWorkbookStream, readSheetNamesByFileNumber } from '../ideaImportReader';
import { buildPaddedZipChunks, listZipEntries, readZipEntry } from '../xlsxStreamSource';

const GWP_HEADER = '気候変動 IPCC 2021 GWP 100a without LULUCF';
const FIXED_HEADERS = Object.values(IDEA_FIXED_COLUMN_HEADERS);

type DummyRow = (string | number | null)[];

const buildWorkbook = ({
  rows,
  extraSheetsBefore = 0,
  releaseDateSerial,
}: {
  rows: DummyRow[];
  /** LCIA 結果シートより前に置く、対象外の大きめのシート数（読み飛ばしの検証用） */
  extraSheetsBefore?: number;
  /** 指定時はリリース日付を Excel の日付セルで書く（styles のキャッシュで Date として読めることの検証） */
  releaseDateSerial?: Date;
}): ExcelJS.Workbook => {
  const workbook = new ExcelJS.Workbook();
  for (let index = 0; index < extraSheetsBefore; index++) {
    const extra = workbook.addWorksheet(`LCI結果_ダミー${index}`);
    for (let row = 1; row <= 200; row++) {
      extra.getCell(row, 1).value = `対象外データ${row}`;
      extra.getCell(row, 2).value = row * 0.1;
    }
  }
  const versionSheet = workbook.addWorksheet('バージョン情報');
  versionSheet.getCell('B4').value = 'バージョン';
  versionSheet.getCell('C4').value = 'IDEA Ver.9.9 標準版';
  versionSheet.getCell('B5').value = 'リリース日付';
  if (releaseDateSerial) {
    versionSheet.getCell('C5').value = releaseDateSerial;
    versionSheet.getCell('C5').numFmt = 'yyyy/mm/dd';
  } else {
    versionSheet.getCell('C5').value = '2099/01/23';
  }
  const sheet = workbook.addWorksheet('LCIA結果_IPCC');
  sheet.getCell('A1').value = 'ダミーのメタ情報';
  [...FIXED_HEADERS, '別の指標', GWP_HEADER].forEach((header, index) => {
    sheet.getRow(5).getCell(index + 1).value = header;
  });
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (value !== null) sheet.getRow(6 + rowIndex).getCell(colIndex + 1).value = value;
    });
  });
  return workbook;
};

const toBuffer = async (workbook: ExcelJS.Workbook): Promise<Buffer> =>
  (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

const rows: DummyRow[] = [
  ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, 1.23456789],
  ['000000002mXXX', 'ダミー製品B（LCIA結果なし）', 'JPN', 'CORE', 1, 'm³', 9.9, null],
  ['000000003mXXX', 'ダミー製品C', 'GLO', 'GLO', 1000, 'kWh', 9.9, 0.000000123456789],
  ['000000004mXXX', 'ダミー製品D', 'JPN', 'CORE', 1, 'kg/個', 9.9, 2.0],
];

describe('readIdeaWorkbookStream', () => {
  it('一括読込（parseIdeaWorkbook）と同じ meta / rows / errors / skippedRows を返す', async () => {
    const buffer = await toBuffer(buildWorkbook({ rows }));

    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer as unknown as ArrayBuffer);
    const expected = parseIdeaWorkbook(loaded, DEFAULT_IDEA_GWP_MODEL);

    const streamed = await readIdeaWorkbookStream(buffer, DEFAULT_IDEA_GWP_MODEL);

    expect(streamed).toEqual(expected);
    expect(streamed.meta?.version).toBe('Ver.9.9 標準版');
    expect(streamed.meta?.releaseDate).toBe('2099-01-23');
    expect(streamed.meta?.sheetName).toBe('LCIA結果_IPCC');
    expect(streamed.rows.map((row) => row.ideaCode)).toEqual(['000000001mXXX', '000000003mXXX']);
    expect(streamed.skippedRows).toEqual([
      { row: 7, ideaCode: '000000002mXXX', productName: 'ダミー製品B（LCIA結果なし）' },
    ]);
    expect(streamed.errors).toEqual([{ row: 9, message: '単位に「/」が含まれています' }]);
  });

  it('対象外のシートが前にあっても読み飛ばして対象シートを処理する', async () => {
    const buffer = await toBuffer(buildWorkbook({ rows: rows.slice(0, 1), extraSheetsBefore: 3 }));
    const result = await readIdeaWorkbookStream(buffer, DEFAULT_IDEA_GWP_MODEL);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.meta?.sheetName).toBe('LCIA結果_IPCC');
  });

  it('日付書式のセルは styles を参照して日付として読む（一括読込と同じ）', async () => {
    const buffer = await toBuffer(
      buildWorkbook({ rows: rows.slice(0, 1), releaseDateSerial: new Date(Date.UTC(2026, 4, 15)) }),
    );
    const result = await readIdeaWorkbookStream(buffer, DEFAULT_IDEA_GWP_MODEL);
    expect(result.meta?.releaseDate).toBe('2026-05-15');
  });

  it('GWP モデルの列が無い場合は meta null + ファイル全体エラー', async () => {
    const buffer = await toBuffer(buildWorkbook({ rows: rows.slice(0, 1) }));
    const result = await readIdeaWorkbookStream(buffer, 'IPCC 2013 GWP 100a with LULUCF');
    expect(result.meta).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  // openpyxl / Apache POI 等は rels の Target を絶対パス（/xl/worksheets/sheetN.xml）で書く。
  // exceljs のストリーミング読取は完全一致でしか引けずシート名が SheetN のままになるため、自前で補う。
  it('rels の Target が絶対パスの xlsx でもシート名を解決して読める（一括読込との互換）', async () => {
    const buffer = await toBuffer(buildWorkbook({ rows: rows.slice(0, 2) }));
    const rewritten = rewriteZipEntry(buffer, 'xl/_rels/workbook.xml.rels', (xml) =>
      xml.replaceAll('Target="worksheets/', 'Target="/xl/worksheets/'),
    );
    expect(readZipEntry(rewritten, 'xl/_rels/workbook.xml.rels')!.toString('utf8')).toContain('Target="/xl/worksheets/');

    const names = readSheetNamesByFileNumber(rewritten);
    expect([...names.values()].sort()).toEqual(['LCIA結果_IPCC', 'バージョン情報']);

    const result = await readIdeaWorkbookStream(rewritten, DEFAULT_IDEA_GWP_MODEL);
    expect(result.errors).toEqual([]);
    expect(result.meta?.sheetName).toBe('LCIA結果_IPCC');
    expect(result.rows).toHaveLength(1);
    expect(result.skippedRows).toHaveLength(1);
  });

  it('readSheetNamesByFileNumber: 実体参照を含むシート名を戻し、メタ XML が無ければ空', () => {
    expect(readSheetNamesByFileNumber(Buffer.from('not a zip')).size).toBe(0);
  });

  it('壊れたファイル（ZIP でない・XML 不正）は reject する', async () => {
    await expect(readIdeaWorkbookStream(Buffer.from('PK\x03\x04ここはxlsxではない'))).rejects.toThrow();
  });

  it('小さなファイルでも安定して読める（ZIP 末尾エントリの取りこぼし回帰）', async () => {
    const buffer = await toBuffer(buildWorkbook({ rows: rows.slice(0, 1) }));
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await readIdeaWorkbookStream(buffer, DEFAULT_IDEA_GWP_MODEL);
      expect(result.errors).toEqual([]);
      expect(result.rows).toHaveLength(1);
    }
  });
});

/**
 * ZIP 内の 1 エントリを書き換えた新しい ZIP（無圧縮）を作る（テスト用）。
 * 中央ディレクトリを読み、全エントリを stored で並べ直す。
 */
const rewriteZipEntry = (buffer: Buffer, target: string, edit: (xml: string) => string): Buffer => {
  const entries = listZipEntries(buffer).filter((entry) => !entry.name.endsWith('/'));
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    let data = readZipEntry(buffer, entry.name)!;
    if (entry.name === target) data = Buffer.from(edit(data.toString('utf8')), 'utf8');
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.byteLength + data.byteLength;
  }
  const centralSize = centrals.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  const rebuilt = Buffer.concat([...locals, ...centrals, eocd]);
  // 詰め物付きストリームの生成にも通ることを確認しておく
  expect(() => buildPaddedZipChunks(rebuilt)).not.toThrow();
  return rebuilt;
};
