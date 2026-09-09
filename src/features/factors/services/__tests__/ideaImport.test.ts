// parseIdeaWorkbook のユニットテスト（docs/idea-scope3-spec.md §6）。
//
// ⚠️ IDEA の実データ値はリポジトリに一切含めない（§0.1）。ここで生成する xlsx は
//    実測済みの「枠構造」（シート名・5行目ヘッダー・6行目以降データ。§0.4）だけを
//    再現したダミー値のフィクスチャで、係数値・製品名はすべて架空の値である。
// ⚠️ 列識別子（'気候変動 IPCC 2021 GWP 100a without LULUCF'）は IPCC 版実ファイルで
//    確認済みの実文字列（§0.3。2026-08-17）。係数値・製品名のみダミーに置き換えている。

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  DEFAULT_IDEA_GWP_MODEL,
  IDEA_FIXED_COLUMN_HEADERS,
  IDEA_GWP_MODEL_OPTIONS,
  IDEA_NO_GWP_COLUMN_ERROR,
  buildIdeaCitationText,
  formatIdeaParseErrors,
  parseIdeaWorkbook,
} from '../ideaImport';

const GWP_HEADER = '気候変動 IPCC 2021 GWP 100a without LULUCF';

const FIXED_HEADERS = [
  IDEA_FIXED_COLUMN_HEADERS.ideaCode,
  IDEA_FIXED_COLUMN_HEADERS.productName,
  IDEA_FIXED_COLUMN_HEADERS.country,
  IDEA_FIXED_COLUMN_HEADERS.dbType,
  IDEA_FIXED_COLUMN_HEADERS.baseFlowAmount,
  IDEA_FIXED_COLUMN_HEADERS.unit,
];

/** ダミーのバージョン情報シートを追加する */
const addVersionSheet = (
  workbook: ExcelJS.Workbook,
  { version = 'IDEA Ver.9.9 標準版', date = '2099/01/23' }: { version?: string | null; date?: string | null } = {},
) => {
  const sheet = workbook.addWorksheet('バージョン情報');
  if (version !== null) sheet.getCell('A1').value = version;
  if (date !== null) sheet.getCell('A2').value = `公開日: ${date}`;
  return sheet;
};

type DummyRow = (string | number | null)[];

/**
 * ダミーの LCIA結果シートを追加する（§0.4 の枠構造: 1〜4行目メタ・5行目ヘッダー・6行目以降データ）。
 * ヘッダー・データとも架空の値のみを使う。
 */
const addLciaSheet = (
  workbook: ExcelJS.Workbook,
  {
    sheetName = 'LCIA結果_GWP',
    headers = [...FIXED_HEADERS, '別の指標', GWP_HEADER],
    groupHeaderRow4 = null as (string | null)[] | null,
    rows = [] as DummyRow[],
  } = {},
) => {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getCell('A1').value = 'ダミーのメタ情報';
  if (groupHeaderRow4) {
    groupHeaderRow4.forEach((value, index) => {
      if (value !== null) sheet.getRow(4).getCell(index + 1).value = value;
    });
  }
  headers.forEach((header, index) => {
    sheet.getRow(5).getCell(index + 1).value = header;
  });
  rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (value !== null) sheet.getRow(6 + rowIndex).getCell(colIndex + 1).value = value;
    });
  });
  return sheet;
};

/** 正常系のダミー行（固定6列 + 無関係な指標列 + GWP列） */
const validRows: DummyRow[] = [
  ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, 1.23456789],
  ['000000002mXXX', 'ダミー製品B', 'GLO', 'GLO', 1, 'kWh', 9.9, 0.000000123456789],
  ['000000003mXXX', 'ダミー製品C（円単位）', 'JPN', 'CORE', 1, '円', 9.9, 0.00000000987654321],
];

describe('parseIdeaWorkbook の正常系', () => {
  it('xlsxラウンドトリップ後もメタ情報とデータ行を取り出せる', async () => {
    const source = new ExcelJS.Workbook();
    addVersionSheet(source);
    addLciaSheet(source, { rows: validRows });

    // 実運用と同じ「シリアライズ済み xlsx を読み込む」経路を通す
    const buffer = await source.xlsx.writeBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([]);
    expect(result.meta).not.toBeNull();
    expect(result.meta?.version).toBe('Ver.9.9 標準版');
    expect(result.meta?.releaseDate).toBe('2099-01-23');
    expect(result.meta?.sheetName).toBe('LCIA結果_GWP');
    expect(result.meta?.gwpModel).toBe(GWP_HEADER);
    expect(result.meta?.citationText).toBe(
      'AIST-IDEA Ver.9.9 標準版 (2099/01/23) 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ',
    );

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      ideaCode: '000000001mXXX',
      productName: 'ダミー製品A',
      country: 'JPN',
      dbType: 'CORE',
      baseFlowAmount: 1,
      unit: 'kg',
      gwpValue: 1.23456789,
    });
    // 円単位原単位のような極小値も数値として桁落ちなく保持される
    expect(result.rows[2].gwpValue).toBe(0.00000000987654321);
  });

  // 実ファイルのリリース日付セルは日付書式が exceljs に認識されず数値のまま返る。
  // 救済が無いと引用表記（レポート出典欄）から公開日が落ちる（§0.2）。
  it('リリース日付が Excel のシリアル値（数値）でも公開日を取り出す', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('バージョン情報');
    sheet.getCell('B4').value = 'バージョン';
    sheet.getCell('C4').value = 'IDEA Ver.9.9 標準版';
    sheet.getCell('B5').value = 'リリース日付';
    sheet.getCell('C5').value = 46157; // 1900日付システムのシリアル値 = 2026-05-15
    addLciaSheet(workbook, { rows: validRows.slice(0, 1) });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([]);
    expect(result.meta?.releaseDate).toBe('2026-05-15');
    expect(result.meta?.citationText).toBe(
      'AIST-IDEA Ver.9.9 標準版 (2026/05/15) 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ',
    );
  });

  it('時刻付きのシリアル値でも日付部分だけを採る（四捨五入で翌日にずらさない）', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('バージョン情報');
    sheet.getCell('A1').value = 'IDEA Ver.9.9 標準版';
    sheet.getCell('B5').value = 'リリース日付';
    sheet.getCell('C5').value = 46157.75; // 2026-05-15 18:00
    addLciaSheet(workbook, { rows: validRows.slice(0, 1) });

    expect(parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL).meta?.releaseDate).toBe('2026-05-15');
  });

  it('日付でないラベルの行の数値はリリース日付として拾わない（『公開製品数』等の誤認防止）', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('バージョン情報');
    sheet.getCell('A1').value = 'IDEA Ver.9.9 標準版';
    // 「公開」を含むが日付ラベルではない。ここを拾うと架空の公開日が引用表記に載る
    sheet.getCell('B2').value = '公開製品数';
    sheet.getCell('C2').value = 46157;
    addLciaSheet(workbook, { rows: validRows.slice(0, 1) });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.meta?.releaseDate).toBeNull();
    // 日付が取れない場合、引用表記は日付なしで生成する（取込自体は成功させる）
    expect(result.meta?.citationText).toBe(
      'AIST-IDEA Ver.9.9 標準版 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ',
    );
  });

  // 実ファイルは同じ AR 版について without / with LULUCF の両列を持つ（without 6列 → with 6列）。
  // 選択肢の value が LULUCF を含まないと、先に現れる without 側へ黙って一致してしまう。
  it('LULUCF の有無が違う同名モデル列があっても選択したほうの列を取る（§0.3）', () => {
    const withoutHeader = '気候変動 IPCC 2013 GWP 100a without LULUCF';
    const withHeader = '気候変動 IPCC 2013 GWP 100a with LULUCF';
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      headers: [...FIXED_HEADERS, withoutHeader, withHeader],
      rows: [['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 1.0, 2.0]],
    });

    // 選択肢の value はいずれも LULUCF の有無まで含んでいること（曖昧一致の防止）
    for (const option of IDEA_GWP_MODEL_OPTIONS) {
      expect(option.value).toMatch(/with(out)? LULUCF$/);
    }

    const without = parseIdeaWorkbook(workbook, 'IPCC 2013 GWP 100a without LULUCF');
    expect(without.meta?.gwpModel).toBe(withoutHeader);
    expect(without.rows[0].gwpValue).toBe(1.0);

    const included = parseIdeaWorkbook(workbook, 'IPCC 2013 GWP 100a with LULUCF');
    expect(included.meta?.gwpModel).toBe(withHeader);
    expect(included.rows[0].gwpValue).toBe(2.0);
  });

  it('シート名は LCIA結果_ 前方一致で探索する（LCIA結果_IPCC 等の名称差を吸収。§0.3）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, { sheetName: 'LCIA結果_IPCC', rows: validRows.slice(0, 1) });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([]);
    expect(result.meta?.sheetName).toBe('LCIA結果_IPCC');
  });

  it('GWP識別子が3〜4行目のグループヘッダーに分かれていても列を特定できる（§0.4）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    // 5行目は 'without LULUCF' のみで、モデル名の前半はグループヘッダー行にある構成
    const gwpCol = FIXED_HEADERS.length + 1;
    const groupHeaderRow4: (string | null)[] = Array(gwpCol).fill(null);
    groupHeaderRow4[gwpCol - 1] = '気候変動 IPCC 2021 GWP 100a';
    addLciaSheet(workbook, {
      headers: [...FIXED_HEADERS, 'without LULUCF'],
      groupHeaderRow4,
      rows: [['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 1.5]],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].gwpValue).toBe(1.5);
    // 保存する列識別子はグループヘッダーと列ヘッダーの連結
    expect(result.meta?.gwpModel).toBe('気候変動 IPCC 2021 GWP 100a without LULUCF');
  });

  it('列位置を固定とみなさない: 列順が入れ替わってもヘッダー文字列で特定する（§0.4）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      headers: [
        GWP_HEADER,
        IDEA_FIXED_COLUMN_HEADERS.unit,
        IDEA_FIXED_COLUMN_HEADERS.ideaCode,
        IDEA_FIXED_COLUMN_HEADERS.productName,
        IDEA_FIXED_COLUMN_HEADERS.country,
      ],
      rows: [[2.5, 'kg', '000000001mXXX', 'ダミー製品A', 'JPN']],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual({
      ideaCode: '000000001mXXX',
      productName: 'ダミー製品A',
      country: 'JPN',
      dbType: '', // DB区分列が無い場合は空扱い
      baseFlowAmount: 1, // 基準フロー列が無い場合は既定の 1
      unit: 'kg',
      gwpValue: 2.5,
    });
  });

  it('基準フローが1以外なら値をそのまま保持する（正規化は算定側 §4.3-2 の責務）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1000, 'kg', 9.9, 4.2]],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].baseFlowAmount).toBe(1000);
    expect(result.rows[0].gwpValue).toBe(4.2);
  });
});

// IPCC 版実ファイルには LCIA 結果を持たない製品（水資源のバランス調整用プロセス等）が
// 10,271行中48行含まれる。これは IDEA 側の意図的な空欄なので、取込全体を落としてはならない。
describe('parseIdeaWorkbook の GWP 空欄行スキップ（§4.1-4）', () => {
  it('GWP値が空欄の行はエラーにせず取込対象外にし、他の行は取り込む', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [
        ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, 1.0],
        // LCIA結果なし（GWP列が空欄）。他の列は埋まっている
        ['000000002mXXX', 'ダミー製品B（LCIA結果なし）', 'JPN', 'CORE', 1, 'm³', 9.9, null],
        ['000000003mXXX', 'ダミー製品C', 'GLO', 'GLO', 1, 'kWh', 9.9, 2.0],
      ],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([]);
    expect(result.meta).not.toBeNull();
    expect(result.rows.map((row) => row.ideaCode)).toEqual(['000000001mXXX', '000000003mXXX']);
    expect(result.skippedRows).toEqual([
      { row: 7, ideaCode: '000000002mXXX', productName: 'ダミー製品B（LCIA結果なし）' },
    ]);
  });

  it("空欄と違い 'N/A' のような非数値セルは従来どおり行エラーにする（データ異常を見逃さない）", () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, 'N/A']],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([{ row: 6, message: 'GWP値が数値ではありません' }]);
    expect(result.skippedRows).toEqual([]);
  });

  // エラーセルは cellText では '' に潰れるため、空欄と同一視するとファイル破損を黙って落とす
  it('Excelのエラー値（#N/A・#DIV/0!）は空欄と区別して行エラーにする', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    const sheet = addLciaSheet(workbook, {
      rows: [
        ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, null],
        ['000000002mXXX', 'ダミー製品B', 'JPN', 'CORE', 1, 'kg', 9.9, null],
      ],
    });
    const gwpCol = FIXED_HEADERS.length + 2;
    sheet.getRow(6).getCell(gwpCol).value = { error: '#N/A' } as never;
    sheet.getRow(7).getCell(gwpCol).value = {
      formula: 'A1/0',
      result: { error: '#DIV/0!' },
    } as never;

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([
      { row: 6, message: 'GWP値が数値ではありません' },
      { row: 7, message: 'GWP値が数値ではありません' },
    ]);
    expect(result.skippedRows).toEqual([]);
  });

  it('空白のみの文字列セルは空欄として取込対象外にする', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, '   ']],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.skippedRows).toHaveLength(1);
    expect(result.errors).toEqual([
      { row: null, message: '「LCIA結果_GWP」シートにGWP値を持つ行がありません（1行すべてが空欄でした）' },
    ]);
  });

  it('スキップした行は重複チェックの対象外にする（挿入しないため UNIQUE に影響しない）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [
        ['000000001mXXX', 'ダミー製品A（LCIA結果なし）', 'JPN', 'CORE', 1, 'kg', 9.9, null],
        ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, 1.0],
      ],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.skippedRows).toHaveLength(1);
  });

  it('全行が空欄の場合は理由の分かるファイル全体エラーにする（GWPモデルの選択違いを疑えるように）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [
        ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, null],
        ['000000002mXXX', 'ダミー製品B', 'JPN', 'CORE', 1, 'kg', 9.9, null],
      ],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.rows).toEqual([]);
    expect(result.skippedRows).toHaveLength(2);
    expect(result.errors).toEqual([
      { row: null, message: '「LCIA結果_GWP」シートにGWP値を持つ行がありません（2行すべてが空欄でした）' },
    ]);
  });

  it('GWP空欄でも他の列が壊れている行はスキップせず行エラーにする（壊れた行を黙って落とさない）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [
        // GWP 空欄かつ製品コードも欠落 = 製品行ではない（データ破損・脚注行等）
        [null, 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, null],
      ],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.skippedRows).toEqual([]);
    expect(result.errors).toContainEqual({ row: 6, message: 'IDEA製品コードが空です' });
    // GWP は空欄なので「数値ではありません」は付けない（原因が二重に出ると読みにくい）
    expect(result.errors).not.toContainEqual({ row: 6, message: 'GWP値が数値ではありません' });
  });

  it('正常系では skippedRows が空になる', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, { rows: validRows });

    expect(parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL).skippedRows).toEqual([]);
  });
});

describe('parseIdeaWorkbook のエラー系（1行でも不正なら取込全体を failed にする。§4.1）', () => {
  it('LIME3版相当（GWP列を持たないファイル）は明確なエラーで弾く（§0.3）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    // LIME3 相当: LCIA結果シートはあるが GWP 列識別子がどこにも無い
    addLciaSheet(workbook, {
      sheetName: 'LCIA結果_統合化',
      headers: [...FIXED_HEADERS, '被害評価（ダミー指標1）', '統合化指標（ダミー指標2）'],
      rows: [['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 0.1, 0.2]],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.meta).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      { row: null, message: IDEA_NO_GWP_COLUMN_ERROR },
    ]);
    expect(IDEA_NO_GWP_COLUMN_ERROR).toBe('GWP列を含むファイルではありません（IPCC版をご利用ください）');
  });

  it('LCIA結果シート自体が無いファイルも GWP 列なしエラーになる', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    workbook.addWorksheet('利用方法');

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([{ row: null, message: IDEA_NO_GWP_COLUMN_ERROR }]);
  });

  it('バージョン情報シートが無ければエラーにする（§4.1-1）', () => {
    const workbook = new ExcelJS.Workbook();
    addLciaSheet(workbook, { rows: validRows.slice(0, 1) });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.meta).toBeNull();
    expect(result.errors).toContainEqual({
      row: null,
      message: '「バージョン情報」シートが見つかりません',
    });
    // 行データ自体は正常なので rows は返る（呼び出し側が errors 有無で failed 判定する）
    expect(result.rows).toHaveLength(1);
  });

  it('バージョン文字列が見つからなければエラーにする', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook, { version: 'バージョン表記なし', date: null });
    addLciaSheet(workbook, { rows: validRows.slice(0, 1) });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.meta).toBeNull();
    expect(result.errors).toContainEqual({
      row: null,
      message: '「バージョン情報」シートからバージョン（Ver.X.X）を取得できませんでした',
    });
  });

  it('固定列（製品コード・製品名・国・単位）の欠落はエラーにする（§4.1-3）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    // IDEA製品コード列が無い
    addLciaSheet(workbook, {
      headers: [
        IDEA_FIXED_COLUMN_HEADERS.productName,
        IDEA_FIXED_COLUMN_HEADERS.country,
        IDEA_FIXED_COLUMN_HEADERS.unit,
        GWP_HEADER,
      ],
      rows: [['ダミー製品A', 'JPN', 'kg', 1.0]],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.meta).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.errors).toContainEqual({
      row: null,
      message: '「LCIA結果_GWP」シートに固定列「IDEA製品コード」が見つかりません',
    });
  });

  it('GWP値が数値でない行は行番号付きのエラーにする（§4.1-4）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [
        ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, 1.0],
        ['000000002mXXX', 'ダミー製品B', 'JPN', 'CORE', 1, 'kg', 9.9, 'N/A'],
      ],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    // 6行目=1行目のデータ、7行目=2行目のデータ
    expect(result.errors).toEqual([{ row: 7, message: 'GWP値が数値ではありません' }]);
    expect(result.rows).toHaveLength(1);
  });

  it("単位に '/' を含む行は行番号付きのエラーにする（§4.1-5）", () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg/個', 9.9, 1.0]],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([{ row: 6, message: '単位に「/」が含まれています' }]);
    expect(result.rows).toEqual([]);
  });

  it('製品コードの欠落・重複は行番号付きのエラーにする', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [
        ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, 1.0],
        [null, 'ダミー製品B', 'JPN', 'CORE', 1, 'kg', 9.9, 1.0],
        ['000000001mXXX', 'ダミー製品C', 'JPN', 'CORE', 1, 'kg', 9.9, 1.0],
      ],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([
      { row: 7, message: 'IDEA製品コードが空です' },
      { row: 8, message: 'IDEA製品コードが重複しています（6行目と同一）' },
    ]);
    expect(result.rows).toHaveLength(1);
  });

  it('基準フローの非数値・0はエラーにする（0はゼロ除算防止）', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [
        ['000000001mXXX', 'ダミー製品A', 'JPN', 'CORE', 'abc', 'kg', 9.9, 1.0],
        ['000000002mXXX', 'ダミー製品B', 'JPN', 'CORE', 0, 'kg', 9.9, 1.0],
      ],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([
      { row: 6, message: '基準フローが数値ではありません' },
      { row: 7, message: '基準フローが0です' },
    ]);
  });

  it('DB幅を超える値は INSERT で全件ロールバックになる前に行エラーにする', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, {
      rows: [['X'.repeat(31), 'ダミー製品A', 'JPN', 'CORE', 1, 'kg', 9.9, 1.0]],
    });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([
      { row: 6, message: 'IDEA製品コードが長すぎます（最大30文字）' },
    ]);
  });

  it('データ行が1件も無いシートはエラーにする', () => {
    const workbook = new ExcelJS.Workbook();
    addVersionSheet(workbook);
    addLciaSheet(workbook, { rows: [] });

    const result = parseIdeaWorkbook(workbook, DEFAULT_IDEA_GWP_MODEL);

    expect(result.errors).toEqual([
      { row: null, message: '「LCIA結果_GWP」シートにデータ行がありません' },
    ]);
  });
});

describe('buildIdeaCitationText（§0.2 の引用形式）', () => {
  it('公開日ありは日付を「(YYYY/MM/DD)」形式で含める', () => {
    expect(buildIdeaCitationText('Ver.9.9 標準版', '2099-01-23')).toBe(
      'AIST-IDEA Ver.9.9 標準版 (2099/01/23) 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ',
    );
  });

  it('公開日が取得できない場合は日付部を省略する', () => {
    expect(buildIdeaCitationText('Ver.9.9 標準版', null)).toBe(
      'AIST-IDEA Ver.9.9 標準版 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ',
    );
  });
});

describe('formatIdeaParseErrors', () => {
  it('行番号付き・ファイル全体エラーを整形する', () => {
    expect(
      formatIdeaParseErrors([
        { row: null, message: 'ファイル全体のエラー' },
        { row: 6, message: '行のエラー' },
      ]),
    ).toBe('ファイル全体のエラー\n行6: 行のエラー');
  });

  it('件数が多い場合は先頭のみ表示して残りを件数で要約する', () => {
    const errors = Array.from({ length: 25 }, (_, index) => ({
      row: index + 6,
      message: 'GWP値が数値ではありません',
    }));
    const formatted = formatIdeaParseErrors(errors, 20);
    expect(formatted.split('\n')).toHaveLength(21);
    expect(formatted.endsWith('…他5件のエラー')).toBe(true);
  });
});
