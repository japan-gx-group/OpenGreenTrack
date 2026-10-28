import { describe, expect, it, vi } from 'vitest';
import { convertImageToWebp, toWebpFileName } from '../webpConversion';

const png = (size = 1000) => new File([new Uint8Array(size)], '9月分.png', { type: 'image/png' });

describe('toWebpFileName', () => {
  it('拡張子を .webp に替え、無ければ足す', () => {
    expect(toWebpFileName('scan.JPG')).toBe('scan.webp');
    expect(toWebpFileName('請求書.2025.png')).toBe('請求書.2025.webp');
    expect(toWebpFileName('scan')).toBe('scan.webp');
  });
});

describe('convertImageToWebp', () => {
  it('PNG・JPEG を WebP にし、元の形式を返す', async () => {
    const encode = vi.fn(async () => new Blob([new Uint8Array(300)], { type: 'image/webp' }));
    const result = await convertImageToWebp(png(), encode, 0.85);
    expect(encode).toHaveBeenCalledWith(expect.any(File), 0.85);
    expect(result.converted).toBe(true);
    if (!result.converted) return;
    expect(result.convertedFrom).toBe('image/png');
    expect(result.file.name).toBe('9月分.webp');
    expect(result.file.type).toBe('image/webp');
    expect(result.file.size).toBe(300);
  });

  it('PDF は変換しない', async () => {
    const encode = vi.fn();
    const pdf = new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
    expect(await convertImageToWebp(pdf, encode)).toEqual({ converted: false, file: pdf, reason: 'not_image' });
    expect(encode).not.toHaveBeenCalled();
  });

  it('ブラウザが WebP を書き出せない（PNG で返る）・書き出せないときは、元のファイルのまま', async () => {
    const original = png();
    expect(await convertImageToWebp(original, async () => new Blob([new Uint8Array(10)], { type: 'image/png' }))).toMatchObject({
      converted: false,
      file: original,
      reason: 'unsupported',
    });
    expect(await convertImageToWebp(original, async () => null)).toMatchObject({ converted: false, reason: 'unsupported' });
    expect(
      await convertImageToWebp(original, async () => {
        throw new Error('decode failed');
      }),
    ).toMatchObject({ converted: false, reason: 'failed' });
  });

  it('変換しても小さくならなければ、元のファイルのまま', async () => {
    const original = png(100);
    expect(await convertImageToWebp(original, async () => new Blob([new Uint8Array(150)], { type: 'image/webp' }))).toMatchObject({
      converted: false,
      file: original,
      reason: 'not_smaller',
    });
  });
});
