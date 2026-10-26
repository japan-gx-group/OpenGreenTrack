// 帳票の画像を WebP に変換して容量を減らす（ブラウザ専用。新しいライブラリは使わず canvas で変換する）。
// 対象は PNG・JPEG だけ。PDF は変換しない（画像にすると文字を選べなくなり、AI の読取りの精度も落ちるため）。
// 変換できない（ブラウザが WebP の書き出しに対応していない）・変換しても小さくならないときは、元のファイルのまま返す。

import type { ConvertibleImageType } from '../types';

/** 変換の品質（0〜1）。請求書の文字が読める範囲で容量を減らす値 */
export const WEBP_QUALITY = 0.85;

export type WebpConversionResult =
  | { converted: true; file: File; convertedFrom: ConvertibleImageType }
  | { converted: false; file: File; reason: 'not_image' | 'unsupported' | 'not_smaller' | 'failed' };

/** 画像を WebP の Blob にする（テストで差し替えられるよう分ける）。書き出せなければ null */
export type WebpEncoder = (file: File, quality: number) => Promise<Blob | null>;

const canvasEncoder: WebpEncoder = async (file, quality) => {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  } finally {
    bitmap.close();
  }
};

const isConvertible = (type: string): type is ConvertibleImageType => type === 'image/png' || type === 'image/jpeg';

/** ファイル名の拡張子を .webp に替える（拡張子が無ければ足す） */
export const toWebpFileName = (fileName: string): string =>
  /\.[^./\\]+$/.test(fileName) ? fileName.replace(/\.[^./\\]+$/, '.webp') : `${fileName}.webp`;

export const convertImageToWebp = async (
  file: File,
  encode: WebpEncoder = canvasEncoder,
  quality: number = WEBP_QUALITY,
): Promise<WebpConversionResult> => {
  if (!isConvertible(file.type)) return { converted: false, file, reason: 'not_image' };
  let blob: Blob | null;
  try {
    blob = await encode(file, quality);
  } catch {
    return { converted: false, file, reason: 'failed' };
  }
  // 対応していないブラウザは、type を指定しても PNG で書き出す（Safari の一部の版など）。
  if (!blob || blob.type !== 'image/webp') return { converted: false, file, reason: 'unsupported' };
  if (blob.size >= file.size) return { converted: false, file, reason: 'not_smaller' };
  return {
    converted: true,
    file: new File([blob], toWebpFileName(file.name), { type: 'image/webp', lastModified: file.lastModified }),
    convertedFrom: file.type,
  };
};
