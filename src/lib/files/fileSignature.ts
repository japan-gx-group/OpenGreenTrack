// ファイルの形式を先頭のバイト（シグネチャ）で判定する（純関数）。ブラウザが付けた種類・ファイル名の拡張子は信じない。
// AI に送る入力の確認（src/lib/ai/inputCheck.ts）と、活動量の帳票の保存（src/features/activity-evidence/）で使う。
// 受け付けるのは PDF と、PNG・JPEG・WebP の画像だけ。

export type DocumentMimeType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';

const startsWith = (data: Uint8Array, bytes: number[], offset = 0) =>
  data.length >= offset + bytes.length && bytes.every((byte, i) => data[offset + i] === byte);

/** 先頭のバイトから形式を判定する。対応していなければ null */
export const detectFileMimeType = (data: Uint8Array): DocumentMimeType | null => {
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'; // RIFF....WEBP
  }
  return null;
};

/** 形式ごとの拡張子（保存先のパスに使う。利用者が付けた拡張子は使わない） */
export const DOCUMENT_EXTENSIONS: Record<DocumentMimeType, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
