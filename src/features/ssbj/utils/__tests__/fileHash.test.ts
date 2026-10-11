import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSsbjSha256, sha256HexOfFile } from '../fileHash';

const blob = (text: string) => new Blob([new TextEncoder().encode(text)]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sha256HexOfFile', () => {
  it('既知の値と同じ SHA-256 を小文字の 16 進 64 文字で返す', async () => {
    // FIPS 180-2 の例（"abc"）と、空のファイル。
    await expect(sha256HexOfFile(blob('abc')))
      .resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await expect(sha256HexOfFile(new Blob([])))
      .resolves.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('同じ中身なら同じ値、1 バイトでも違えば違う値になる', async () => {
    const original = await sha256HexOfFile(blob('取締役会議事録 第3版'));
    expect(await sha256HexOfFile(blob('取締役会議事録 第3版'))).toBe(original);
    expect(await sha256HexOfFile(blob('取締役会議事録 第4版'))).not.toBe(original);
    expect(isSsbjSha256(original)).toBe(true);
  });

  it('Web Crypto が使えない接続（https でない）では、計算できない旨のエラーにする', async () => {
    vi.stubGlobal('crypto', {});
    await expect(sha256HexOfFile(blob('abc'))).rejects.toThrow('https');
  });

  it('ファイルを読めないときは、選び直しを促すエラーにする', async () => {
    const unreadable = { arrayBuffer: () => Promise.reject(new Error('NotReadableError')) } as unknown as Blob;
    await expect(sha256HexOfFile(unreadable)).rejects.toThrow('ファイルを読み込めませんでした');
  });
});

describe('isSsbjSha256', () => {
  it('小文字の 16 進 64 文字だけを受け付ける（DB の check 制約と同じ）', () => {
    const valid = 'a'.repeat(64);
    expect(isSsbjSha256(valid)).toBe(true);
    expect(isSsbjSha256('A'.repeat(64))).toBe(false);
    expect(isSsbjSha256('a'.repeat(63))).toBe(false);
    expect(isSsbjSha256('a'.repeat(65))).toBe(false);
    expect(isSsbjSha256(`g${'a'.repeat(63)}`)).toBe(false);
    expect(isSsbjSha256(`${valid}\n`)).toBe(false);
  });
});
