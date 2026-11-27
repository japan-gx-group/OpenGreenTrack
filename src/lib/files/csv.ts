// CSV の読み書きに共通で使うヘルパー。
// 書き出し（downloadCsv）は「Mac 版 Excel でも文字化けしない」形式で出力し、
// 読み込み（decodeCsvBuffer / splitCsvLine）は Excel が書き出した CSV も扱えるようにする。
//
// 背景: Mac 版 Excel は UTF-8 の BOM を無視して開くことがあり、日本語が文字化けする。
// これを確実に避けるため、UTF-16LE + BOM(FF FE) でエンコードする（Excel はこの BOM を
// 確実に判別して Unicode として開く）。併せて区切り文字はカンマではなくタブにする。
// Excel は Unicode テキストのフィールド分割を、ロケールのリスト区切り設定に依存せず
// タブで安定して行うため。拡張子は .csv のままで Excel / Numbers とも問題なく開ける。

import { downloadBlob } from '@/lib/files/download';

type CsvCell = string | number | null | undefined;

// セル内にタブ・改行・ダブルクォートを含む値を RFC4180 準拠でクォートする。
// フォーミュラインジェクション緩和: 文字列セルが = + - @ で始まる場合は先頭に ' を付し、
// Excel 等が数式として評価しないようにする（数値セルは対象外）。
const escapeCell = (value: CsvCell): string => {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[\t"\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

// 文字列を「UTF-16LE の BOM(FF FE) + 本文」のバイト列へ変換する。charCodeAt は UTF-16 の
// コード単位を返すため、下位バイト→上位バイトの順（リトルエンディアン）に並べればそのまま
// UTF-16LE になる。
const encodeUtf16leWithBom = (text: string): ArrayBuffer => {
  const buffer = new ArrayBuffer((text.length + 1) * 2);
  const view = new DataView(buffer);
  view.setUint16(0, 0xfeff, true); // BOM をリトルエンディアンで書き込む
  for (let i = 0; i < text.length; i++) {
    view.setUint16((i + 1) * 2, text.charCodeAt(i), true);
  }
  return buffer;
};

// 2 次元配列を downloadCsv と同じ形式（タブ区切り・CRLF・必要なセルだけクォート）の文字列にする。
// 書き出した内容をそのまま読み込み側のテストに渡せるよう、ダウンロードと切り離して公開する。
export const toCsvText = (rows: CsvCell[][]): string =>
  rows.map((row) => row.map(escapeCell).join('\t')).join('\r\n');

// 2 次元配列（先頭行はヘッダー想定）を CSV としてダウンロードさせる。
export const downloadCsv = (fileName: string, rows: CsvCell[][]): void => {
  const content = toCsvText(rows);
  const blob = new Blob([encodeUtf16leWithBom(content)], {
    type: 'text/csv;charset=utf-16le;',
  });
  downloadBlob(blob, fileName);
};

// CSV のバイト列を文字列へデコードする。
// Excel から書き出した CSV は Shift_JIS（CP932）で保存されることが多く、UTF-8 固定で読むと
// 日本語が文字化けする。まず UTF-8（fatal）で試し、不正バイトで失敗したら Shift_JIS へフォールバックする。
// どちらでもデコードできない場合は日本語メッセージで通知する。
export const decodeCsvBuffer = (buffer: ArrayBuffer): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // UTF-8 として不正 → Shift_JIS を試す
  }

  try {
    return new TextDecoder('shift_jis', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('文字コードのデコードに失敗しました。UTF-8またはShift_JIS形式のCSVファイルを使用してください。');
  }
};

// UTF-16（BOM付き）を判別してデコードする。downloadCsv の出力が UTF-16LE + BOM のため、
// 未編集のままの再インポートで必須。BOMがなければ decodeCsvBuffer
// （UTF-8 → Shift_JIS フォールバック）へ委ねる。
export const decodeCsvBufferAllowingUtf16 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer);
  }
  return decodeCsvBuffer(buffer);
};

/** splitCsvRecords が返す1レコード。text はクォートを残した元の文字列。 */
export interface CsvRecord {
  text: string;
  /** 改行をまたぐクォートの対応が取れず、1物理行として区切り直したレコード */
  malformedQuote: boolean;
}

// CSV テキストをレコード（論理行）に分ける。ダブルクォートで囲まれたセル内の改行
// （downloadCsv が改行入りのセルをクォートして書き出したもの、Excel で Alt+Enter を使ったもの）
// では区切らない。テキスト全体を先に改行で分割すると、改行入りのセルが2行に割れてしまうため。
// 返すレコードはクォートを残した元の文字列のまま（列への分割とクォートの除去は splitCsvLine が行う）。
// 空行も空のレコードとして残す（Excel の行番号と、何件目のレコードかを一致させるため）。
// クォートの始まりとみなすのはセルの先頭（レコードの先頭か区切り文字の直後）の " だけ。
// 手書きの CSV でセルの途中に囲まれていない " があっても、後ろのレコードを巻き込まず、その行だけの列数エラーで済ませる。
//
// 手書きの CSV でクォートの対応が崩れていると、閉じない " が後ろの行をすべて1つのセルに飲み込み、
// 行が黙って消えて行番号もずれる。正しいクォートなら閉じる " の直後は区切り文字・改行・末尾のどれかなので、
// 改行をまたいだクォートが「それ以外の文字の前で閉じた」か「末尾まで閉じなかった」ときは壊れているとみなし、
// そのレコードを最初の物理改行で区切り直して malformedQuote を立てる（壊れた行だけのエラーにする）。
// 改行をまたいでいない崩れ（例: "ab"c）は1物理行に収まっており後ろを巻き込まないため、従来どおり splitCsvLine に任せる。
export const splitCsvRecords = (text: string, delimiter: string = ','): CsvRecord[] => {
  const records: CsvRecord[] = [];
  let start = 0; // 読み途中のレコードの開始位置
  let inQuotes = false;
  let quoteSpansNewline = false; // 今のクォートが改行をまたいだか
  let atFieldStart = true;

  // text[start, newlineIndex) を1レコードとして確定する（CRLF の \r は落とす）。
  const pushRecord = (newlineIndex: number, malformedQuote: boolean) => {
    const end = newlineIndex > start && text[newlineIndex - 1] === '\r' ? newlineIndex - 1 : newlineIndex;
    records.push({ text: text.slice(start, end), malformedQuote });
    start = newlineIndex + 1;
    inQuotes = false;
    quoteSpansNewline = false;
    atFieldStart = true;
  };

  // クォートの対応が崩れたレコードを、開始位置から最初の物理改行までの1行として区切り直す。
  // 戻り値は次に読む位置（その次の行の先頭）。
  const rewindMalformed = (): number => {
    const newlineIndex = text.indexOf('\n', start);
    pushRecord(newlineIndex === -1 ? text.length : newlineIndex, true);
    return start;
  };

  let i = 0;
  for (;;) {
    if (i >= text.length) {
      // 改行をまたいだクォートが末尾まで閉じなかった。そのレコードの最初の物理行の次から読み直す
      if (inQuotes && quoteSpansNewline) {
        i = rewindMalformed();
        continue;
      }
      break;
    }

    const char = text[i];
    if (inQuotes) {
      if (char === '\n') {
        quoteSpansNewline = true;
      } else if (char === '"') {
        const next = text[i + 1];
        if (next === '"') {
          i += 2; // エスケープされたダブルクォート（""）。クォートは閉じない
          continue;
        }
        const closesCleanly =
          next === undefined || next === delimiter || next === '\r' || next === '\n';
        if (quoteSpansNewline && !closesCleanly) {
          i = rewindMalformed();
          continue;
        }
        inQuotes = false;
      }
    } else if (char === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (char === '\n') {
      pushRecord(i, false);
    } else {
      atFieldStart = char === delimiter;
    }
    i++;
  }

  // 最後のレコード（末尾が改行なら空のレコード）。巻き戻しで末尾まで確定済みなら足さない
  if (start <= text.length) records.push({ text: text.slice(start), malformedQuote: false });
  return records;
};

// RFC4180 準拠のごく簡易なフィールド分割。
// ダブルクォートで囲まれたフィールド内のカンマ（桁区切りや期間表記など）を列区切りとして
// 誤認しないようにする。囲みクォート内の "" は 1 つの " へアンエスケープする。
// 返り値は囲みクォートを取り除いた各フィールド。
// 排出係数CSVインポート（factors/services/factorCsvImport.ts）が downloadCsv 出力形式の
// タブ区切りも扱えるよう、区切り文字を引数で指定できる。
export const splitCsvLine = (line: string, delimiter: string = ','): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // エスケープされたダブルクォート（"" → "）
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
};
