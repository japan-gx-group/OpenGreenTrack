import { describe, expect, it } from 'vitest';
import { decodeCsvBuffer, splitCsvLine, splitCsvRecords, toCsvText } from '../csv';

const utf8Buffer = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

const bytesBuffer = (bytes: number[]): ArrayBuffer =>
  new Uint8Array(bytes).buffer;

describe('decodeCsvBuffer', () => {
  it('UTF-8 のバイト列を正しくデコードする', () => {
    const text = '拠点名,種別\n東京本社,電気';
    expect(decodeCsvBuffer(utf8Buffer(text))).toBe(text);
  });

  it('UTF-8 として不正なバイト列は Shift_JIS でデコードする', () => {
    // 'あ' の Shift_JIS バイト列（0x82 0xA0）。先頭 0x82 は UTF-8 として不正なため
    // Shift_JIS フォールバックが働き 'あ' に復元される（文字化けしない）。
    expect(decodeCsvBuffer(bytesBuffer([0x82, 0xa0]))).toBe('あ');
  });

  it('UTF-8 BOM 付きのバイト列は BOM を除去してデコードする', () => {
    // Excel は文字化け防止で UTF-8 BOM 付きの CSV を書き出す。取り込み時に先頭列の
    // ヘッダー名へ BOM が混ざらないことを担保する。
    const text = '拠点名,種別\n東京本社,電気';
    const bom = [0xef, 0xbb, 0xbf];
    const body = Array.from(new TextEncoder().encode(text));
    expect(decodeCsvBuffer(bytesBuffer([...bom, ...body]))).toBe(text);
  });

  it('UTF-8 でも Shift_JIS でも解釈できないバイト列はエラーにする', () => {
    expect(() => decodeCsvBuffer(bytesBuffer([0xff, 0xfe, 0x00]))).toThrow(
      '文字コードのデコードに失敗しました',
    );
  });
});

describe('splitCsvLine', () => {
  it('ダブルクォートで囲まれた区切り文字は列区切りにしない', () => {
    expect(splitCsvLine('東京本社,"1,234",kWh')).toEqual(['東京本社', '1,234', 'kWh']);
  });

  it('エスケープされたダブルクォート（""）を1つの " へ復元する', () => {
    expect(splitCsvLine('"He said ""hi""",x')).toEqual(['He said "hi"', 'x']);
  });

  it('区切り文字を指定するとタブ区切りも分割できる', () => {
    expect(splitCsvLine('東京本社\t電気\t100', '\t')).toEqual(['東京本社', '電気', '100']);
  });
});

// レコードの本文だけを取り出す（壊れたクォートの印を見ないテスト用）
const recordTexts = (text: string, delimiter: string) =>
  splitCsvRecords(text, delimiter).map(record => record.text);

describe('splitCsvRecords', () => {
  it('クォートの外の改行（CRLF・LF）のとき、レコードを区切る', () => {
    expect(recordTexts('a\tb\r\nc\td\ne\tf', '\t')).toEqual(['a\tb', 'c\td', 'e\tf']);
  });

  it('クォートの中に改行があるとき、区切らずにセルの一部として残す', () => {
    expect(splitCsvRecords('id\t"大阪\n工場"\tx\r\nnext', '\t')).toEqual([
      { text: 'id\t"大阪\n工場"\tx', malformedQuote: false },
      { text: 'next', malformedQuote: false },
    ]);
  });

  it('クォートの中にエスケープされた "" があっても、クォートの内外を取り違えない', () => {
    expect(recordTexts('"a""\nb"\tc\nd', '\t')).toEqual(['"a""\nb"\tc', 'd']);
  });

  it('空行があるとき、行番号がずれないよう空のレコードとして残す', () => {
    expect(recordTexts('a\n\nb', '\t')).toEqual(['a', '', 'b']);
  });

  it('セルの途中にある囲まれていない " のとき、クォートの始まりとみなさず後ろの行を巻き込まない', () => {
    expect(recordTexts('a\t13" モニター\nb\tc\nd\te', '\t')).toEqual(['a\t13" モニター', 'b\tc', 'd\te']);
  });

  it('カンマ区切りのとき、カンマ直後の " をクォートの始まりとみなす', () => {
    expect(recordTexts('a,"x\ny"\nb', ',')).toEqual(['a,"x\ny"', 'b']);
  });

  it('改行をまたいだクォートが末尾まで閉じないとき、その行だけを壊れたレコードにして後ろの行を読み直す', () => {
    expect(splitCsvRecords('a\n"b\nc\r\nd', '\t')).toEqual([
      { text: 'a', malformedQuote: false },
      { text: '"b', malformedQuote: true },
      { text: 'c', malformedQuote: false },
      { text: 'd', malformedQuote: false },
    ]);
  });

  it('改行をまたいだクォートが区切り文字・改行以外の直前で閉じたとき、その行だけを壊れたレコードにする', () => {
    expect(splitCsvRecords('"a\nb\n"c"x\td', '\t')).toEqual([
      { text: '"a', malformedQuote: true },
      { text: 'b', malformedQuote: false },
      { text: '"c"x\td', malformedQuote: false },
    ]);
  });

  it('改行をまたがないクォートが区切り文字以外の直前で閉じたとき、従来どおり1行のレコードとして扱う', () => {
    expect(splitCsvRecords('"ab"c\td\ne', '\t')).toEqual([
      { text: '"ab"c\td', malformedQuote: false },
      { text: 'e', malformedQuote: false },
    ]);
  });

  it('末尾が改行で終わるとき、最後に空のレコードを残す', () => {
    expect(recordTexts('a\r\nb\r\n', '\t')).toEqual(['a', 'b', '']);
  });
});

describe('toCsvText', () => {
  it('セルに改行があるとき、ダブルクォートで囲んでタブ区切り・CRLF で出力する', () => {
    expect(toCsvText([['ID', '拠点名'], ['loc-1', '大阪\n工場']])).toBe('ID\t拠点名\r\nloc-1\t"大阪\n工場"');
  });
});
