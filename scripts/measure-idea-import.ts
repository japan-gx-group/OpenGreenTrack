// IDEA インポーターの処理時間・メモリ計測スクリプト（docs/idea-scope3-spec.md §4.1）。
//
// 約1万行（既定 10,300 行。§0.4 の実測行数）× 影響評価モデル列多数のダミー xlsx を
// exceljs で生成し、実運用と同じ「ストリーミング読取（readIdeaWorkbookStream）」経路の
// 時間とメモリを計測する。比較用に、旧経路（workbook.xlsx.load で全体をメモリ展開 →
// parseIdeaWorkbook）も同じファイルで計測できる。IDEA の実データ値は一切使わない（§0.1）。
//
// 実行: node --expose-gc --import ./scripts/register-ts-resolver.ts scripts/measure-idea-import.ts [行数] [追加列数] [stream|load|both]
//   （Node 24 は TypeScript を直接実行できる。--expose-gc は計測前の GC 用で省略可）
//   例: node --expose-gc --import ./scripts/register-ts-resolver.ts scripts/measure-idea-import.ts 10300 300 both
//
// 生成した xlsx は OS の一時ディレクトリに書き出し、計測はファイルから読み直して行う
// （生成時のオブジェクトが計測に混ざらないようにする）。ピークは 20ms 間隔のサンプリング。

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  DEFAULT_IDEA_GWP_MODEL,
  parseIdeaWorkbook,
  type IdeaParseResult,
} from '../src/features/factors/services/ideaImport.ts';
import { readIdeaWorkbookStream } from '../src/features/factors/services/ideaImportReader.ts';

const ROW_COUNT = Number(process.argv[2] ?? 10_300);
// 実ファイルは影響評価モデル別の係数列を多数持つ（IPCC 版で約 300 列）。
// GWP 列以外のダミー指標列を足してファイルサイズを実物相当へ寄せる。
const EXTRA_COLUMN_COUNT = Number(process.argv[3] ?? 60);
const MODE = (process.argv[4] ?? 'stream') as 'stream' | 'load' | 'both';

const GWP_HEADER = '気候変動 IPCC 2021 GWP 100a without LULUCF';

const buildDummyIdeaXlsx = async (filePath: string): Promise<void> => {
  // 生成側もストリーミング書き出しにする（300 列 × 1 万行を一括モデルで持つと生成だけで数 GB 使う）
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useSharedStrings: true });

  const versionSheet = workbook.addWorksheet('バージョン情報');
  versionSheet.getCell('A1').value = 'IDEA Ver.9.9 標準版';
  versionSheet.getCell('A2').value = '2099/01/23';
  versionSheet.commit();

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
  sheet.getRow(5).commit();

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
    row.commit();
  }
  sheet.commit();
  await workbook.commit();
};

const formatMiB = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

interface Measurement {
  label: string;
  seconds: number;
  heapBefore: number;
  heapPeak: number;
  rssPeak: number;
  result: IdeaParseResult;
}

/** 実行中の heapUsed / rss のピークをサンプリングしながら run を計測する */
const measure = async (label: string, run: () => Promise<IdeaParseResult>): Promise<Measurement> => {
  globalThis.gc?.();
  const before = process.memoryUsage();
  let heapPeak = before.heapUsed;
  let rssPeak = before.rss;
  const sampler = setInterval(() => {
    const usage = process.memoryUsage();
    heapPeak = Math.max(heapPeak, usage.heapUsed);
    rssPeak = Math.max(rssPeak, usage.rss);
  }, 20);
  const start = performance.now();
  try {
    const result = await run();
    const usage = process.memoryUsage();
    heapPeak = Math.max(heapPeak, usage.heapUsed);
    rssPeak = Math.max(rssPeak, usage.rss);
    return {
      label,
      seconds: (performance.now() - start) / 1000,
      heapBefore: before.heapUsed,
      heapPeak,
      rssPeak,
      result,
    };
  } finally {
    clearInterval(sampler);
  }
};

const print = ({ label, seconds, heapBefore, heapPeak, rssPeak, result }: Measurement) => {
  console.log(`--- ${label} ---`);
  console.log(`所要時間      : ${seconds.toFixed(2)} 秒`);
  console.log(`正常行 / エラー: ${result.rows.length} / ${result.errors.length}`);
  console.log(`heapUsed ピーク: ${formatMiB(heapPeak)}（開始時 ${formatMiB(heapBefore)}、Δ ${formatMiB(heapPeak - heapBefore)}）`);
  console.log(`rss ピーク     : ${formatMiB(rssPeak)}`);
  if (result.errors.length > 0) {
    console.error('想定外のパースエラー:', result.errors.slice(0, 5));
    process.exitCode = 1;
  }
};

const main = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'idea-measure-'));
  const filePath = path.join(dir, 'dummy-idea.xlsx');
  try {
    console.log(`ダミー IDEA xlsx を生成中（${ROW_COUNT}行 × 固定6列+${EXTRA_COLUMN_COUNT + 1}係数列）...`);
    await buildDummyIdeaXlsx(filePath);
    const buffer = readFileSync(filePath);
    console.log(`生成完了: ファイルサイズ ${formatMiB(buffer.byteLength)}（${filePath}）`);
    // 計測対象は「Storage から取得した Buffer」からの読み取り（Route Handler と同じ入力形）
    writeFileSync(filePath, buffer);

    if (MODE === 'stream' || MODE === 'both') {
      print(
        await measure('ストリーミング読取（readIdeaWorkbookStream。現行経路）', () =>
          readIdeaWorkbookStream(readFileSync(filePath), DEFAULT_IDEA_GWP_MODEL),
        ),
      );
    }
    if (MODE === 'load' || MODE === 'both') {
      print(
        await measure('一括読込（workbook.xlsx.load → parseIdeaWorkbook。旧経路。比較用）', async () => {
          const workbook = new ExcelJS.Workbook();
          // exceljs の型定義は独自の Buffer（ArrayBuffer 拡張）を要求するため型だけ合わせる
          await workbook.xlsx.load(readFileSync(filePath) as unknown as ArrayBuffer);
          return parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);
        }),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

void main();
