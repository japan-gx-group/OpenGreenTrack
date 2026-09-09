// IDEA インポーターの処理時間・メモリ計測スクリプト（docs/idea-scope3-spec.md §4.1）。
//
// 約1万行（既定 10,300 行。§0.4 の実測行数）× 影響評価モデル列多数のダミー xlsx を
// exceljs で生成し、実運用と同じ「xlsx 読み込み → parseIdeaWorkbook」経路の
// 時間とメモリを計測する。IDEA の実データ値は一切使わない（§0.1）。
//
// 実行: node --expose-gc scripts/measure-idea-import.ts [行数] [追加列数]
//   （Node 24 は TypeScript を直接実行できる。--expose-gc は計測前の GC 用で省略可）

import ExcelJS from 'exceljs';
import {
  DEFAULT_IDEA_GWP_MODEL,
  parseIdeaWorkbook,
} from '../src/features/factors/services/ideaImport.ts';

const ROW_COUNT = Number(process.argv[2] ?? 10_300);
// 実ファイルは影響評価モデル別の係数列を多数持つ（LIME3 版で数十列）。
// GWP 列以外のダミー指標列を足してファイルサイズを実物相当へ寄せる。
const EXTRA_COLUMN_COUNT = Number(process.argv[3] ?? 60);

const GWP_HEADER = '気候変動 IPCC 2021 GWP 100a without LULUCF';

const buildDummyIdeaXlsx = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();

  const versionSheet = workbook.addWorksheet('バージョン情報');
  versionSheet.getCell('A1').value = 'IDEA Ver.9.9 標準版';
  versionSheet.getCell('A2').value = '2099/01/23';

  const sheet = workbook.addWorksheet('LCIA結果_GWP');
  sheet.getCell('A1').value = 'ダミーのメタ情報';
  const headers = [
    'IDEA製品コード',
    'IDEA製品名',
    '国',
    'DB区分',
    '基準フロー',
    '単位',
    ...Array.from({ length: EXTRA_COLUMN_COUNT }, (_, index) => `ダミー指標${index + 1}`),
    GWP_HEADER,
  ];
  headers.forEach((header, index) => {
    sheet.getRow(5).getCell(index + 1).value = header;
  });

  for (let index = 0; index < ROW_COUNT; index++) {
    const row = sheet.getRow(6 + index);
    row.getCell(1).value = `${String(index).padStart(9, '0')}mXXX`;
    row.getCell(2).value = `ダミー製品（架空の品目名サンプル）${index}`;
    row.getCell(3).value = index % 5 === 0 ? 'GLO' : 'JPN';
    row.getCell(4).value = index % 5 === 0 ? 'GLO' : 'CORE';
    row.getCell(5).value = 1;
    row.getCell(6).value = index % 3 === 0 ? 'kg' : index % 3 === 1 ? 'kWh' : '円';
    for (let extra = 0; extra < EXTRA_COLUMN_COUNT; extra++) {
      row.getCell(7 + extra).value = (index + 1) * 1e-7 + extra;
    }
    row.getCell(7 + EXTRA_COLUMN_COUNT).value = (index + 1) * 1.23456789e-4;
  }

  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
};

const formatMiB = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

const main = async () => {
  console.log(`ダミー IDEA xlsx を生成中（${ROW_COUNT}行 × 固定6列+${EXTRA_COLUMN_COUNT + 1}係数列）...`);
  const buffer = await buildDummyIdeaXlsx();
  console.log(`生成完了: ファイルサイズ ${formatMiB(buffer.byteLength)}`);

  globalThis.gc?.();
  const before = process.memoryUsage();

  const loadStart = performance.now();
  const workbook = new ExcelJS.Workbook();
  // exceljs の型定義は独自の Buffer（ArrayBuffer 拡張）を要求するため型だけ合わせる
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const loadEnd = performance.now();

  const parseStart = performance.now();
  const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);
  const parseEnd = performance.now();

  const after = process.memoryUsage();

  console.log('--- 計測結果 ---');
  console.log(`xlsx 読み込み (workbook.xlsx.load): ${((loadEnd - loadStart) / 1000).toFixed(2)} 秒`);
  console.log(`パース (parseIdeaWorkbook)        : ${((parseEnd - parseStart) / 1000).toFixed(2)} 秒`);
  console.log(`正常行: ${result.rows.length} / エラー: ${result.errors.length}`);
  console.log(`heapUsed: ${formatMiB(before.heapUsed)} → ${formatMiB(after.heapUsed)} (Δ ${formatMiB(after.heapUsed - before.heapUsed)})`);
  console.log(`rss     : ${formatMiB(before.rss)} → ${formatMiB(after.rss)} (Δ ${formatMiB(after.rss - before.rss)})`);

  if (result.errors.length > 0) {
    console.error('想定外のパースエラー:', result.errors.slice(0, 5));
    process.exitCode = 1;
  }
};

void main();
