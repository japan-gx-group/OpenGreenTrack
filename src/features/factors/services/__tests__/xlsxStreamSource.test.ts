// xlsxStreamSource（exceljs WorkbookReader 向けの詰め物付き ZIP ストリーム）のテスト。
// 「ZIP 末尾の小さなエントリ（xl/workbook.xml 等）を WorkbookReader が取りこぼす」挙動が、
// 詰め物エントリの追加で確実に解消されることを、exceljs 自身で読み戻して検証する。

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import {
  STREAM_CHUNK_BYTES,
  ZIP_PADDING_BYTES,
  ZIP_PADDING_ENTRY_NAME,
  buildPaddedZipChunks,
  createXlsxStreamSource,
  listZipEntries,
  readZipCentralDirectory,
  readZipEntry,
} from '../xlsxStreamSource';

/** 小さなワークブック（exceljs は xl/workbook.xml を ZIP の末尾に書く） */
const buildSmallXlsx = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('バージョン情報').getCell('A1').value = 'IDEA Ver.9.9 標準版';
  const sheet = workbook.addWorksheet('LCIA結果_GWP');
  sheet.getCell('A5').value = 'IDEA製品コード';
  sheet.getCell('A6').value = '000000001mXXX';
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
};

/** WorkbookReader で読み、届いたエントリ種別とシート名を順に返す */
const readEntries = async (input: Readable): Promise<string[]> => {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'cache',
    entries: 'emit',
  });
  const seen: string[] = [];
  // WorkbookReader は EventEmitter だが型定義に on() が無い
  (reader as unknown as NodeJS.EventEmitter).on('entry', (entry: { type: string }) => seen.push(entry.type));
  for await (const sheet of reader) {
    seen.push(`sheet:${(sheet as unknown as { name: string }).name}`);
    for await (const row of sheet) void row;
  }
  return seen;
};

describe('readZipCentralDirectory', () => {
  it('xlsx の終端レコードから中央ディレクトリの位置とエントリ数を読む', async () => {
    const xlsx = await buildSmallXlsx();
    const info = readZipCentralDirectory(xlsx);
    expect(info.entryCount).toBeGreaterThan(5);
    expect(info.centralDirectoryOffset + info.centralDirectorySize + 22).toBe(xlsx.byteLength);
  });

  it('ZIP でないバイト列は例外にする', () => {
    expect(() => readZipCentralDirectory(Buffer.from('PK\x03\x04ここはxlsxではない'))).toThrow();
    expect(() => readZipCentralDirectory(Buffer.alloc(0))).toThrow();
  });
});

describe('buildPaddedZipChunks', () => {
  it('元のエントリをそのまま保ち、詰め物エントリを末尾に 1 件追加した有効な ZIP になる', async () => {
    const xlsx = await buildSmallXlsx();
    const original = readZipCentralDirectory(xlsx);
    const padded = Buffer.concat(buildPaddedZipChunks(xlsx));

    const info = readZipCentralDirectory(padded);
    expect(info.entryCount).toBe(original.entryCount + 1);
    expect(padded.byteLength).toBeGreaterThan(xlsx.byteLength + ZIP_PADDING_BYTES);
    // 元の ZIP のローカルエントリ部分は無変更（先頭〜元の中央ディレクトリ直前）
    expect(padded.subarray(0, original.centralDirectoryOffset).equals(xlsx.subarray(0, original.centralDirectoryOffset))).toBe(true);
    // 詰め物の名前が中央ディレクトリに載る
    expect(padded.subarray(info.centralDirectoryOffset).includes(Buffer.from(ZIP_PADDING_ENTRY_NAME))).toBe(true);
  });
});

describe('listZipEntries / readZipEntry', () => {
  it('中央ディレクトリのエントリを列挙し、名前指定で展開できる', async () => {
    const xlsx = await buildSmallXlsx();
    const names = listZipEntries(xlsx).map((entry) => entry.name);
    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('xl/_rels/workbook.xml.rels');
    const workbookXml = readZipEntry(xlsx, 'xl/workbook.xml')!.toString('utf8');
    expect(workbookXml).toContain('バージョン情報');
    expect(workbookXml).toContain('LCIA結果_GWP');
    expect(readZipEntry(xlsx, 'xl/nothing.xml')).toBeNull();
  });
});

describe('createXlsxStreamSource', () => {
  it('チャンクは STREAM_CHUNK_BYTES 以下に切られる（unzipper 側のコピーをチャンク 1 個ぶんに抑える）', async () => {
    const xlsx = await buildSmallXlsx();
    const chunks = buildPaddedZipChunks(xlsx);
    expect(chunks.length).toBeGreaterThan(ZIP_PADDING_BYTES / STREAM_CHUNK_BYTES);
    for (const chunk of chunks) expect(chunk.byteLength).toBeLessThanOrEqual(STREAM_CHUNK_BYTES);
  });

  it('WorkbookReader が xl/workbook.xml を読み、全シートの名前を解決できる（20回連続で安定）', async () => {
    const xlsx = await buildSmallXlsx();
    for (let attempt = 0; attempt < 20; attempt++) {
      const seen = await readEntries(createXlsxStreamSource(xlsx));
      expect(seen).toContain('workbook');
      expect(seen).toContain('sheet:バージョン情報');
      expect(seen).toContain('sheet:LCIA結果_GWP');
    }
  });

  it('ZIP でないバイト列はそのまま流し、WorkbookReader 側が読み取りエラーにする', async () => {
    const source = createXlsxStreamSource(Buffer.from('PK\x03\x04ここはxlsxではない'));
    await expect(readEntries(source)).rejects.toThrow();
  });
});
