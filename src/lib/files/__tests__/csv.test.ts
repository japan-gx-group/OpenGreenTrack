import { describe, expect, it, vi } from 'vitest';
import { decodeCsvBuffer, downloadCsv, splitCsvLine } from '../csv';

vi.mock('../download', () => ({ downloadBlob: vi.fn() }));
import { downloadBlob } from '../download';

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

describe('downloadCsv', () => {
  it('日本語・改行・引用符を保ち、空白の後の数式も無効化する', async () => {
    downloadCsv('試験.csv', [['日本語', '説明'], ['本文\n"引用"', ' \n=1+1']]);
    const blob = vi.mocked(downloadBlob).mock.calls[0]?.[0];
    expect(blob).toBeDefined();
    const bytes = await blob!.arrayBuffer();
    expect(new Uint8Array(bytes).slice(0, 2)).toEqual(new Uint8Array([0xff, 0xfe]));
    const body = new TextDecoder('utf-16le').decode(bytes);
    expect(body).toContain('"本文\n""引用"""');
    expect(body).toContain('"\' \n=1+1"');
  });
});
