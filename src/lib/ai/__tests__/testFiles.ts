// AI のテストで使う、形式ごとの最小のファイルの中身（先頭のバイトだけを本物に合わせる）。

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

export const PDF_BYTES = Uint8Array.from([...ascii('%PDF-1.7\n'), ...ascii('dummy')]);
export const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
export const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
export const WEBP_BYTES = Uint8Array.from([...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP'), ...ascii('VP8 ')]);
export const GIF_BYTES = Uint8Array.from(ascii('GIF89a'));
