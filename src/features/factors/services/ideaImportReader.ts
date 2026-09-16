// IDEA Excel のストリーミング読取（docs/idea-scope3-spec.md §4.1）。
//
// exceljs の WorkbookReader で xlsx（ZIP）をエントリ単位に流し、シートごとの行を
// createIdeaParser（ideaImport.ts）へ逐次渡す。ワークブック全体をメモリに展開する
// `workbook.xlsx.load()` は 1 万行 × 約 300 列の実ファイル相当（約 14MB）で 1GB 超のヒープを
// 使ったため、この経路に置き換えた（対象外のシート・列はパーサーが読み飛ばす）。
//
// Node 専用（exceljs のストリーム API はブラウザでは動かない）だが service_role には触れないため、
// 計測スクリプト（scripts/measure-idea-import.ts）からも import できる。取込ジョブ本体は
// ideaImportServer.ts（サーバ専用）が呼ぶ。

import ExcelJS from 'exceljs';
import type { Row } from 'exceljs';
import {
  DEFAULT_IDEA_GWP_MODEL,
  parseIdeaSheetStream,
  type IdeaParseResult,
  type IdeaSheetStream,
} from './ideaImport';
import { createXlsxStreamSource, readZipEntry } from './xlsxStreamSource';

/** exceljs の WorksheetReader は型定義に name を持たないが、実体は workbook.xml から名前を解決して持つ */
type WorksheetReaderWithName = ExcelJS.stream.xlsx.WorksheetReader & { name?: string };

/** exceljs の WorkbookReader は EventEmitter だが型定義に on() が無い */
type WorkbookReaderEvents = {
  on(event: 'entry', listener: (entry: { type: string; id?: string }) => void): unknown;
};

const XML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
};

/** XML 属性値の実体参照を戻す（シート名に & や " が含まれる場合） */
const decodeXmlAttribute = (value: string): string =>
  value.replace(/&(?:lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (match, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return XML_ENTITIES[match] ?? match;
  });

const attribute = (attrs: string, name: string): string | null => {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return match ? decodeXmlAttribute(match[1]) : null;
};

/**
 * xl/workbook.xml と xl/_rels/workbook.xml.rels から「ワークシートのファイル番号 → シート名」を作る。
 *
 * exceljs の WorkbookReader は rels の Target を `worksheets/sheetN.xml` の完全一致でしか引かないため、
 * `/xl/worksheets/sheetN.xml` のような絶対パスで書かれた xlsx（openpyxl / Apache POI 等が出力する形。
 * 一括読込の workbook.xlsx.load はこれを扱える）ではシート名が既定の `SheetN` のままになり、
 * シート名で対象を探すこのパーサーが「シートが見つからない」で失敗する。ここで自前に解決して補う。
 * どちらの XML も無い・壊れている場合は空の Map を返し、exceljs の解決結果に任せる。
 */
export const readSheetNamesByFileNumber = (buffer: Buffer): Map<number, string> => {
  const names = new Map<number, string>();
  let workbookXml: string;
  let relsXml: string;
  try {
    const workbookEntry = readZipEntry(buffer, 'xl/workbook.xml');
    const relsEntry = readZipEntry(buffer, 'xl/_rels/workbook.xml.rels');
    if (!workbookEntry || !relsEntry) return names;
    workbookXml = workbookEntry.toString('utf8');
    relsXml = relsEntry.toString('utf8');
  } catch {
    return names;
  }

  const fileNumberByRelId = new Map<string, number>();
  for (const match of relsXml.matchAll(/<Relationship\s([^>]*?)\/?>/g)) {
    const id = attribute(match[1], 'Id');
    const target = attribute(match[1], 'Target');
    const fileNumber = target ? /worksheets\/sheet(\d+)\.xml$/i.exec(target) : null;
    if (id && fileNumber) fileNumberByRelId.set(id, Number(fileNumber[1]));
  }
  for (const match of workbookXml.matchAll(/<sheet\s([^>]*?)\/?>/g)) {
    const name = attribute(match[1], 'name');
    const relId = attribute(match[1], '[A-Za-z0-9]+:id');
    const fileNumber = relId ? fileNumberByRelId.get(relId) : undefined;
    if (name !== null && fileNumber !== undefined) names.set(fileNumber, name);
  }
  return names;
};

/**
 * WorkbookReader が流すシートを、パーサー向けの { name, rows } に包む。
 * シート名は自前の対応表（readSheetNamesByFileNumber）を優先し、無ければ exceljs の解決結果を使う。
 * ファイル番号は、WorkbookReader がシートを yield する直前に同期的に出す 'entry' イベント
 * （entries: 'emit'）から拾う。
 */
async function* readSheets(
  reader: ExcelJS.stream.xlsx.WorkbookReader,
  namesByFileNumber: Map<number, string>,
): AsyncGenerator<IdeaSheetStream> {
  let currentFileNumber: number | null = null;
  (reader as unknown as WorkbookReaderEvents).on('entry', (entry) => {
    if (entry.type === 'worksheet' && entry.id !== undefined) currentFileNumber = Number(entry.id);
  });
  for await (const sheet of reader) {
    const worksheet = sheet as WorksheetReaderWithName;
    const resolvedName =
      currentFileNumber !== null ? namesByFileNumber.get(currentFileNumber) : undefined;
    yield { name: resolvedName ?? worksheet.name ?? '', rows: worksheet as AsyncIterable<Row> };
  }
}

/**
 * xlsx のバイト列をストリーミングで読み、IDEA パース結果を返す。
 * 壊れた xlsx（ZIP でない・XML 不正）は reject する（呼び出し側で「読み込み失敗」として扱う）。
 *
 * オプション:
 * - sharedStrings: 'cache' … 文字列セル（製品名等）は共有文字列テーブル経由なので保持が必要
 * - styles: 'cache' … 日付書式の判定に使う（一括読込と同じくシリアル値を Date として返す）
 * - hyperlinks: 'ignore' … 不要
 *
 * Excel が書き出す xlsx は sharedStrings.xml がシートより後ろにあるため、WorkbookReader は
 * シート XML をいったん一時ファイルへ退避してから解析する（メモリには載せない）。
 * 入力は createXlsxStreamSource（xlsxStreamSource.ts）で包む。WorkbookReader が ZIP 末尾の
 * 小さなエントリ（xl/workbook.xml 等）を取りこぼす挙動への対処で、詳細はそちらのコメント参照。
 */
export const readIdeaWorkbookStream = async (
  input: Buffer | Uint8Array,
  gwpModel: string = DEFAULT_IDEA_GWP_MODEL,
): Promise<IdeaParseResult> => {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const namesByFileNumber = readSheetNamesByFileNumber(buffer);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(createXlsxStreamSource(buffer), {
    worksheets: 'emit',
    sharedStrings: 'cache',
    styles: 'cache',
    hyperlinks: 'ignore',
    // シートのファイル番号を拾うため（readSheets）
    entries: 'emit',
  });
  return parseIdeaSheetStream(readSheets(reader, namesByFileNumber), gwpModel);
};
