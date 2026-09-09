// IDEA Excel（BYOライセンス）のパース純関数（docs/idea-scope3-spec.md §0.3〜0.4・§4.1）。
//
// - シート名は固定とみなさない: `LCIA結果_` 前方一致でシートを探索する（§0.3）。
// - 列位置も固定とみなさない: 5行目の列ヘッダー文字列（+3〜4行目のグループヘッダー）の
//   突き合わせで対象列を特定する（§0.4）。
// - 1行でも不正があれば取込全体を failed とするため、行番号付きでエラーを収集する（§4.1）。
// - IDEA の実データ値はリポジトリに置けない（§0.1）。テストは同一構造のダミー値で行う。
//
// ★シート名・列識別子は IPCC 版実ファイル（Ver.4.0 標準版）で確認済み（2026-08-17。§0.3）。
//   シート `LCIA結果_IPCC`、4行目に `気候変動 IPCC 2021 GWP 100a without LULUCF` 等の12列、
//   5行目に単位 `kg-CO₂eq`。実ファイルの値・製品名はリポジトリに置かない（§0.1）。
//
// この module は純関数のみで構成し、exceljs へは型参照だけを持つ（実体の import は
// 呼び出し側 = サーバー専用モジュールが行う。ブラウザバンドルへの混入防止）。

import type { CellValue, Workbook, Worksheet } from 'exceljs';

/** 採用する GWP モデルの既定値（§0.3。SSBJ = ISSB S2 が要求する AR6 GWP100 に整合） */
export const DEFAULT_IDEA_GWP_MODEL = 'IPCC 2021 GWP 100a without LULUCF';

/**
 * インポート画面で選択できる GWP モデルの識別子（§0.3）。
 * value は `LCIA結果_*` シートの列ヘッダーとの部分一致に使う識別子文字列。
 *
 * ★ LULUCF の有無まで value に含めること。実ファイルは同じ AR 版について
 *   `... without LULUCF` と `... with LULUCF` の両列を持つため、'IPCC 2013 GWP 100a' のような
 *   曖昧な value は先に現れる without 側へ黙って一致してしまう（列順は AR6/AR5/AR4 の
 *   without 6列 → with 6列）。
 */
export const IDEA_GWP_MODEL_OPTIONS = [
  { value: DEFAULT_IDEA_GWP_MODEL, label: 'IPCC 2021 (AR6) GWP 100a・LULUCF除く（推奨）' },
  { value: 'IPCC 2021 GWP 100a with LULUCF', label: 'IPCC 2021 (AR6) GWP 100a・LULUCF含む' },
  { value: 'IPCC 2013 GWP 100a without LULUCF', label: 'IPCC 2013 (AR5) GWP 100a・LULUCF除く' },
  { value: 'IPCC 2013 GWP 100a with LULUCF', label: 'IPCC 2013 (AR5) GWP 100a・LULUCF含む' },
] as const;

/** GWP 列を持たないファイル（LIME3 版等）に返す取込エラー文言（§0.3・§4.1-2） */
export const IDEA_NO_GWP_COLUMN_ERROR =
  'GWP列を含むファイルではありません（IPCC版をご利用ください）';

/** `LCIA結果_*` シートの探索プレフィックス（§0.3。前方一致） */
export const IDEA_LCIA_SHEET_PREFIX = 'LCIA結果_';

/** バージョン情報シート名（§0.4） */
export const IDEA_VERSION_SHEET_NAME = 'バージョン情報';

/** 固定列（A〜F相当）のヘッダー文字列（§0.4。位置ではなくこの文字列で列を特定する） */
export const IDEA_FIXED_COLUMN_HEADERS = {
  ideaCode: 'IDEA製品コード',
  productName: 'IDEA製品名',
  country: '国',
  dbType: 'DB区分',
  baseFlowAmount: '基準フロー',
  unit: '単位',
} as const;

/** 列ヘッダー行（5行目）とデータ開始行（6行目）。§0.4 の実測構造 */
const HEADER_ROW = 5;
const GROUP_HEADER_ROWS = [3, 4] as const;
const DATA_START_ROW = 6;

/** DB 列幅（idea_factors）に合わせた最大長。超過は INSERT 全体を落とすため行エラーにする */
const MAX_LENGTHS = {
  ideaCode: 30,
  productName: 300,
  country: 10,
  dbType: 20,
  unit: 30,
} as const;

export interface IdeaParsedMeta {
  /** 例 'Ver.4.0 標準版'（バージョン情報シートから取得） */
  version: string;
  /** 'YYYY-MM-DD'。取得できない場合は null */
  releaseDate: string | null;
  /** 実際に採用した列識別子（idea_imports.gwpModel へ保存。レポート出典欄に表示） */
  gwpModel: string;
  /** GWP 列が見つかったシート名 */
  sheetName: string;
  /** 引用表記（§0.2 の指定形式で自動生成） */
  citationText: string;
}

export interface IdeaParsedRow {
  ideaCode: string;
  productName: string;
  country: string;
  dbType: string;
  baseFlowAmount: number;
  unit: string;
  gwpValue: number;
}

export interface IdeaParseError {
  /** Excel 上の行番号（1始まり）。ファイル全体のエラーは null */
  row: number | null;
  message: string;
}

/**
 * GWP セルが空欄のため取込対象外にした行（§4.1-4）。
 * IDEA には LCIA 結果を持たない製品（水資源バランス調整用プロセス・配分用の電力プロセス等）が
 * 実在し、これは意図的な空欄でデータ不正ではない。取込全体は失敗させずスキップする。
 */
export interface IdeaSkippedRow {
  /** Excel 上の行番号（1始まり） */
  row: number;
  ideaCode: string;
  productName: string;
}

export interface IdeaParseResult {
  meta: IdeaParsedMeta | null;
  rows: IdeaParsedRow[];
  errors: IdeaParseError[];
  /** GWP 値が空欄のため取込対象外にした行（エラーではない。§4.1-4） */
  skippedRows: IdeaSkippedRow[];
}

/**
 * セル値を表示文字列へ正規化する。richText / hyperlink / formula の各形も
 * exceljs の CellValue として現れるため、ここで一括して吸収する。
 */
const cellText = (value: CellValue): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return formatDateISO(value).replaceAll('-', '/');
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return cellText(value.result as CellValue);
  }
  return '';
};

/** セル値を数値へ正規化する。数値化できない場合は null（呼び出し側で行エラーにする） */
const cellNumber = (value: CellValue): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replaceAll(',', '');
    if (normalized === '') return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value !== null && typeof value === 'object' && 'result' in value) {
    return cellNumber(value.result as CellValue);
  }
  return null;
};

/**
 * セルが「値なし（空欄）」かを判定する。
 *
 * `cellText(value) === ''` では判定できない: cellText はエラー値（`{ error: '#N/A' }`）や
 * 未知のセル形も '' に潰すため、壊れたセルまで空欄＝取込対象外として黙って落としてしまう。
 * 空欄はスキップ、「値はあるが数値化できない」セルは行エラー、と扱いを分けるための判定（§4.1-4）。
 * 判断がつかない形は空欄としない（＝行エラー側に倒す）。
 */
const isBlankCell = (value: CellValue): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (value instanceof Date) return false;
  if (typeof value === 'object') {
    // エラー値（#N/A・#DIV/0!・#REF! 等）は「値はあるが数値化できない」= 空欄ではない
    if ('error' in value) return false;
    if ('formula' in value || 'sharedFormula' in value) {
      const result = (value as { result?: CellValue }).result;
      // 未計算（キャッシュ結果なし）は「値なし」と断定できないため空欄扱いにしない
      return result === undefined ? false : isBlankCell(result);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim() === '';
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim() === '';
  }
  return false;
};

/**
 * Excel のシリアル値（1900日付システム）を UTC の Date にする。
 *
 * バージョン情報シートの「リリース日付」セルは、実ファイル（Ver.4.0 標準版）では
 * 日付書式が exceljs に認識されず **数値のまま**（例 46157）返ってくる。この救済が無いと
 * releaseDate が null になり、レポート出典欄の引用表記から公開日が落ちる（§0.2 の指定形式）。
 * バージョン番号のような小さな数値を日付と誤認しないよう、妥当な範囲外は null にする。
 */
const EXCEL_SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MIN_EXCEL_DATE_SERIAL = 20_000; // 1954年頃
const MAX_EXCEL_DATE_SERIAL = 80_000; // 2119年頃

const excelSerialToDate = (serial: number): Date | null => {
  if (!Number.isFinite(serial)) return null;
  if (serial < MIN_EXCEL_DATE_SERIAL || serial > MAX_EXCEL_DATE_SERIAL) return null;
  // 時刻付き（46157.75 = 18:00）は日付部分だけを採る。四捨五入すると翌日にずれる。
  return new Date(EXCEL_SERIAL_EPOCH_UTC + Math.trunc(serial) * 86_400_000);
};

/** Date を UTC 基準で 'YYYY-MM-DD' にする（exceljs は xlsx の日付を UTC の Date で返す） */
const formatDateISO = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * 引用表記の自動生成（§0.2 の指定形式）。
 * 例: 'AIST-IDEA Ver.4.0 標準版 (2026/05/15) 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ'
 */
export const buildIdeaCitationText = (version: string, releaseDate: string | null): string => {
  const datePart = releaseDate ? ` (${releaseDate.replaceAll('-', '/')})` : '';
  return `AIST-IDEA ${version}${datePart} 国立研究開発法人 産業技術総合研究所 安全科学研究部門 IDEAラボ`;
};

/**
 * リリース日付のラベルセル判定（実ファイルは『リリース日付』。表記ゆれを吸収する）。
 * 「日」まで必須にして『公開製品数』のような日付でないラベルを除外する
 * （拾ってしまうと、行内の無関係な数値が公開日として引用表記に載る）。
 */
const RELEASE_DATE_LABEL = /(リリース|公開|発行|更新)日/;

/** バージョン情報シートから version / releaseDate を取り出す（§4.1-1） */
const parseVersionSheet = (
  sheet: Worksheet,
): { version: string | null; releaseDate: string | null } => {
  let version: string | null = null;
  let releaseDate: string | null = null;

  sheet.eachRow((row) => {
    // 「リリース日付」ラベルセルの列。数値セルをシリアル値と解釈してよいのは、この
    // ラベルより右のセルだけに限定する（行内の無関係な数値を日付と誤認しないため。
    // 実ファイルは B列『リリース日付』/ C列 日付）。
    const labelColumns: number[] = [];
    row.eachCell((cell, colNumber) => {
      if (RELEASE_DATE_LABEL.test(cellText(cell.value))) labelColumns.push(colNumber);
    });
    const releaseDateLabelColumn = labelColumns.length > 0 ? Math.min(...labelColumns) : null;

    row.eachCell((cell, colNumber) => {
      const value = cell.value;
      // 日付セル（xlsx のシリアル値）を優先。テキストの日付表記もフォールバックで拾う。
      if (releaseDate === null && value instanceof Date) {
        releaseDate = formatDateISO(value);
        return;
      }
      // exceljs が日付書式を認識できず数値のまま返すセルの救済（実ファイルのリリース日付）
      if (
        releaseDate === null &&
        releaseDateLabelColumn !== null &&
        colNumber > releaseDateLabelColumn
      ) {
        const serial = cellNumber(value);
        const serialDate = serial !== null ? excelSerialToDate(serial) : null;
        if (serialDate !== null) {
          releaseDate = formatDateISO(serialDate);
          return;
        }
      }
      const text = cellText(value);
      if (version === null) {
        // 'AIST-IDEA Ver.4.0 標準版' のような前置きが付いても 'Ver.' 以降を版として扱う。
        const versionMatch = text.match(/Ver\.?\s*\d[^\n]*/);
        if (versionMatch) {
          version = versionMatch[0].trim().slice(0, 100);
        }
      }
      if (releaseDate === null) {
        const dateMatch = text.match(/(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})/);
        if (dateMatch) {
          releaseDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
        }
      }
    });
  });

  return { version, releaseDate };
};

/**
 * 対象シートから GWP モデル列を探す。5行目の列ヘッダー単独、および
 * 3〜5行目の連結文字列（グループヘッダー + 列ヘッダー）に識別子が含まれるかで判定する
 * （§0.4: 版・バリアントによる列ズレ・ヘッダー分割に頑健にする）。
 * 戻り値は { col, identifier }。identifier は idea_imports.gwpModel へ保存する実際の列識別子。
 */
const findGwpColumn = (
  sheet: Worksheet,
  gwpModel: string,
): { col: number; identifier: string } | null => {
  const headerRow = sheet.getRow(HEADER_ROW);
  const columnCount = Math.max(sheet.columnCount, headerRow.cellCount);

  for (let col = 1; col <= columnCount; col++) {
    const headerText = cellText(headerRow.getCell(col).value);
    const groupTexts = GROUP_HEADER_ROWS.map((rowNumber) =>
      cellText(sheet.getRow(rowNumber).getCell(col).value),
    );
    const joined = [...groupTexts, headerText].filter((text) => text !== '').join(' ');
    if (joined.includes(gwpModel)) {
      // varchar(200) に収まるよう切り詰める（識別子は通常数十文字）
      return { col, identifier: joined.slice(0, 200) };
    }
  }
  return null;
};

/** 5行目のヘッダー文字列から固定列の列番号を引く（§0.4。見つからない列は undefined） */
const findFixedColumns = (
  sheet: Worksheet,
): Partial<Record<keyof typeof IDEA_FIXED_COLUMN_HEADERS, number>> => {
  const headerRow = sheet.getRow(HEADER_ROW);
  const columnCount = Math.max(sheet.columnCount, headerRow.cellCount);
  const found: Partial<Record<keyof typeof IDEA_FIXED_COLUMN_HEADERS, number>> = {};

  for (let col = 1; col <= columnCount; col++) {
    const text = cellText(headerRow.getCell(col).value);
    for (const [key, header] of Object.entries(IDEA_FIXED_COLUMN_HEADERS)) {
      const typedKey = key as keyof typeof IDEA_FIXED_COLUMN_HEADERS;
      if (found[typedKey] === undefined && text === header) {
        found[typedKey] = col;
      }
    }
  }
  return found;
};

/**
 * IDEA Excel ワークブックを解析する（純関数）。
 *
 * @param workbook 読み込み済みの exceljs Workbook
 * @param gwpModel 採用する GWP モデルの列識別子（部分一致。既定は DEFAULT_IDEA_GWP_MODEL）
 * @returns meta（バージョン・引用表記等）/ rows（正常行）/ errors（行番号付きエラー）/
 *          skippedRows（GWP 空欄で取込対象外にした行）。
 *          errors が 1 件でもあれば取込全体を failed にすること（§4.1。部分取込はしない）。
 *          skippedRows はエラーではないため取込は続行する（§4.1-4）。
 */
export const parseIdeaWorkbook = (
  workbook: Workbook,
  gwpModel: string = DEFAULT_IDEA_GWP_MODEL,
): IdeaParseResult => {
  const errors: IdeaParseError[] = [];
  const rows: IdeaParsedRow[] = [];
  const skippedRows: IdeaSkippedRow[] = [];

  // 1. バージョン情報シート（§4.1-1）
  const versionSheet = workbook.getWorksheet(IDEA_VERSION_SHEET_NAME);
  let version: string | null = null;
  let releaseDate: string | null = null;
  if (!versionSheet) {
    errors.push({ row: null, message: `「${IDEA_VERSION_SHEET_NAME}」シートが見つかりません` });
  } else {
    const parsed = parseVersionSheet(versionSheet);
    version = parsed.version;
    releaseDate = parsed.releaseDate;
    if (version === null) {
      errors.push({
        row: null,
        message: `「${IDEA_VERSION_SHEET_NAME}」シートからバージョン（Ver.X.X）を取得できませんでした`,
      });
    }
  }

  // 2. `LCIA結果_` 前方一致でシートを探索し、指定 GWP モデルの列を持つ最初のシートを採用する（§0.3）
  const lciaSheets = workbook.worksheets.filter((sheet) =>
    sheet.name.startsWith(IDEA_LCIA_SHEET_PREFIX),
  );
  let targetSheet: Worksheet | null = null;
  let gwpColumn: { col: number; identifier: string } | null = null;
  for (const sheet of lciaSheets) {
    const foundColumn = findGwpColumn(sheet, gwpModel);
    if (foundColumn) {
      targetSheet = sheet;
      gwpColumn = foundColumn;
      break;
    }
  }
  if (!targetSheet || !gwpColumn) {
    // LIME3 版（被害評価・統合化指標のみ）等。シート自体が無い場合も同じ文言でよい（§0.3）
    errors.push({ row: null, message: IDEA_NO_GWP_COLUMN_ERROR });
    return { meta: null, rows: [], errors, skippedRows };
  }

  // 3. 固定列の存在チェック（§4.1-3。製品コード / 製品名 / 国 / 単位 は必須）
  const fixedColumns = findFixedColumns(targetSheet);
  const requiredKeys = ['ideaCode', 'productName', 'country', 'unit'] as const;
  for (const key of requiredKeys) {
    if (fixedColumns[key] === undefined) {
      errors.push({
        row: null,
        message: `「${targetSheet.name}」シートに固定列「${IDEA_FIXED_COLUMN_HEADERS[key]}」が見つかりません`,
      });
    }
  }
  if (errors.length > 0 && requiredKeys.some((key) => fixedColumns[key] === undefined)) {
    return { meta: null, rows: [], errors, skippedRows };
  }

  // 4. データ行（6行目以降。§0.4）
  const seenCodes = new Map<string, number>();
  targetSheet.eachRow((row, rowNumber) => {
    if (rowNumber < DATA_START_ROW) return;

    const ideaCode = cellText(row.getCell(fixedColumns.ideaCode!).value);
    const productName = cellText(row.getCell(fixedColumns.productName!).value);
    const country = cellText(row.getCell(fixedColumns.country!).value);
    const unit = cellText(row.getCell(fixedColumns.unit!).value);
    const dbType =
      fixedColumns.dbType !== undefined ? cellText(row.getCell(fixedColumns.dbType).value) : '';
    const baseFlowRaw =
      fixedColumns.baseFlowAmount !== undefined
        ? row.getCell(fixedColumns.baseFlowAmount).value
        : null;
    const gwpRaw = row.getCell(gwpColumn!.col).value;

    // 全列が空の行はデータ終端・整形上の空行として無視する
    if (ideaCode === '' && productName === '' && country === '' && unit === '' && gwpRaw === null) {
      return;
    }

    // GWP セルが空欄の製品は取込対象外にする（§4.1-4）。IDEA には LCIA 結果を持たない製品
    // （上水道の消費型/非消費型使用水、水資源バランス調整用の沈殿処理サービス、配分用の
    // ごみ焼却火力・廃油火力の電力プロセス等）が実データに数十件含まれ、これは IDEA 側の
    // 意図的な空欄である。GWP が無い製品は Scope3 の原単位として使えないため idea_factors へは
    // 入れないが、データ不正ではないので取込全体は失敗させず、件数だけを利用者に伝える。
    // 一方 'N/A' のような「値はあるが数値化できない」セルは従来どおり行エラー（＝全体 failed）。
    // スキップ扱いにするのは他の検証をすべて通った行だけにする（製品コード欠落等を伴う壊れた行を
    // 黙って落とさないため。判定は下の rowErrors 集計後に行う）。
    const gwpIsBlank = isBlankCell(gwpRaw);

    const rowErrors: string[] = [];
    if (ideaCode === '') rowErrors.push('IDEA製品コードが空です');
    else if (ideaCode.length > MAX_LENGTHS.ideaCode) {
      rowErrors.push(`IDEA製品コードが長すぎます（最大${MAX_LENGTHS.ideaCode}文字）`);
    }
    if (productName === '') rowErrors.push('IDEA製品名が空です');
    else if (productName.length > MAX_LENGTHS.productName) {
      rowErrors.push(`IDEA製品名が長すぎます（最大${MAX_LENGTHS.productName}文字）`);
    }
    if (country === '') rowErrors.push('国が空です');
    else if (country.length > MAX_LENGTHS.country) {
      rowErrors.push(`国が長すぎます（最大${MAX_LENGTHS.country}文字）`);
    }
    if (dbType.length > MAX_LENGTHS.dbType) {
      rowErrors.push(`DB区分が長すぎます（最大${MAX_LENGTHS.dbType}文字）`);
    }
    if (unit === '') rowErrors.push('単位が空です');
    else if (unit.includes('/')) {
      // §4.1-5: 単位換算（kg-CO2e/単位 の分解）を壊すため '/' 入りの単位は取り込まない
      rowErrors.push('単位に「/」が含まれています');
    } else if (unit.length > MAX_LENGTHS.unit) {
      rowErrors.push(`単位が長すぎます（最大${MAX_LENGTHS.unit}文字）`);
    }

    const gwpValue = cellNumber(gwpRaw);
    // 空欄は「値が無い」であって不正値ではないため、ここではエラーにしない（下でスキップ扱い）
    if (!gwpIsBlank && gwpValue === null) rowErrors.push('GWP値が数値ではありません');

    // 基準フローは省略時 1（§0.4: 通常 1）。0 は正規化（gwpValue / baseFlowAmount）で
    // ゼロ除算になるため不正値として弾く。
    let baseFlowAmount = 1;
    if (baseFlowRaw !== null && baseFlowRaw !== undefined && cellText(baseFlowRaw) !== '') {
      const parsedBaseFlow = cellNumber(baseFlowRaw);
      if (parsedBaseFlow === null) rowErrors.push('基準フローが数値ではありません');
      else if (parsedBaseFlow === 0) rowErrors.push('基準フローが0です');
      else baseFlowAmount = parsedBaseFlow;
    }

    // UNIQUE(importId, ideaCode) 違反で INSERT 全体が落ちる前に、ファイル内重複を行エラーにする。
    // スキップ行は挿入しないため UNIQUE に影響せず、重複判定の対象にもしない。
    if (ideaCode !== '' && !gwpIsBlank) {
      const firstRow = seenCodes.get(ideaCode);
      if (firstRow !== undefined) {
        rowErrors.push(`IDEA製品コードが重複しています（${firstRow}行目と同一）`);
      } else {
        seenCodes.set(ideaCode, rowNumber);
      }
    }

    if (rowErrors.length > 0) {
      for (const message of rowErrors) {
        errors.push({ row: rowNumber, message });
      }
      return;
    }

    // 他に問題が無く GWP だけが空欄の行＝ LCIA 結果を持たない製品。取込対象外にする（§4.1-4）
    if (gwpIsBlank) {
      skippedRows.push({ row: rowNumber, ideaCode, productName });
      return;
    }

    rows.push({
      ideaCode,
      productName,
      country,
      dbType,
      baseFlowAmount,
      unit,
      gwpValue: gwpValue!,
    });
  });

  if (rows.length === 0 && !errors.some((error) => error.row !== null)) {
    // 全行が GWP 空欄だった場合は「データが無い」ではなく理由を示す（GWP モデルの選択違い等）
    errors.push({
      row: null,
      message:
        skippedRows.length > 0
          ? `「${targetSheet.name}」シートにGWP値を持つ行がありません（${skippedRows.length}行すべてが空欄でした）`
          : `「${targetSheet.name}」シートにデータ行がありません`,
    });
  }

  const meta: IdeaParsedMeta | null =
    version !== null
      ? {
          version,
          releaseDate,
          gwpModel: gwpColumn.identifier,
          sheetName: targetSheet.name,
          citationText: buildIdeaCitationText(version, releaseDate),
        }
      : null;

  return { meta, rows, errors, skippedRows };
};

/**
 * 取込結果表示・idea_imports.errorMessage 用にエラーを整形する。
 * 件数が多い場合は先頭 maxLines 件 + 残件数のサマリにする（1万行のファイルで
 * errorMessage が無制限に膨らむのを防ぐ）。
 */
export const formatIdeaParseErrors = (errors: IdeaParseError[], maxLines = 20): string => {
  const lines = errors.map((error) =>
    error.row !== null ? `行${error.row}: ${error.message}` : error.message,
  );
  if (lines.length <= maxLines) return lines.join('\n');
  return [...lines.slice(0, maxLines), `…他${lines.length - maxLines}件のエラー`].join('\n');
};
