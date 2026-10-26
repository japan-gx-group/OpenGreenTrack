// AI に送る入力の確認（サーバ専用）。用途の範囲（種類・量）と、ファイルの形式を送る前に確かめる。
//
// ファイルの形式は先頭のバイトで判定する（ブラウザが付けた種類・ファイル名の拡張子は信じない）。
// 受け付けるのは PDF と、PNG・JPEG・WebP の画像だけ。判定できたものだけを、提供元へ渡す形（base64）にする。

import 'server-only';
import { createHash } from 'node:crypto';
import { detectFileMimeType, type DocumentMimeType } from '@/lib/files/fileSignature';
import type { AiInputKind, AiPurpose } from './purposes';

// 形式の判定は帳票の保存と共通（src/lib/files/fileSignature.ts）。この入口からも呼べるよう名前を残す。
export { detectFileMimeType };

export type AiFileMimeType = DocumentMimeType;

/** 機能が共通の入口に渡す入力 */
export type AiInputPart =
  | { type: 'text'; text: string }
  | { type: 'pdf'; data: Uint8Array }
  | { type: 'image'; data: Uint8Array };

/** 提供元へ渡す形にした入力 */
export type AiPreparedInput =
  | { type: 'text'; text: string }
  | { type: 'file'; mimeType: AiFileMimeType; base64: string };

/** 監査ログに残す、入力の要約（中身は残さない） */
export interface AiInputSummary {
  type: AiInputKind;
  bytes: number;
  /** ファイルの SHA-256（16 進）。文字には付けない */
  sha256?: string;
}

export type PrepareInputsResult =
  | { ok: true; prepared: AiPreparedInput[]; summary: AiInputSummary[] }
  | { ok: false; reason: string };

const byteLengthOf = (part: AiInputPart): number =>
  part.type === 'text' ? Buffer.byteLength(part.text, 'utf8') : part.data.byteLength;

export const prepareAiInputs = (purpose: AiPurpose, input: AiInputPart[]): PrepareInputsResult => {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, reason: '入力がありません' };
  }

  let totalBytes = 0;
  const prepared: AiPreparedInput[] = [];
  const summary: AiInputSummary[] = [];

  for (const part of input) {
    if (!purpose.inputs.includes(part.type)) {
      return { ok: false, reason: `この用途では ${part.type} を送れません` };
    }
    const bytes = byteLengthOf(part);
    totalBytes += bytes;
    if (totalBytes > purpose.maxInputBytes) {
      return { ok: false, reason: '送る量が上限を超えています' };
    }

    if (part.type === 'text') {
      prepared.push({ type: 'text', text: part.text });
      summary.push({ type: 'text', bytes });
      continue;
    }

    const mimeType = detectFileMimeType(part.data);
    const matchesKind =
      part.type === 'pdf' ? mimeType === 'application/pdf' : mimeType !== null && mimeType !== 'application/pdf';
    if (!mimeType || !matchesKind) {
      return { ok: false, reason: part.type === 'pdf' ? 'PDF のファイルではありません' : 'PNG・JPEG・WebP の画像ではありません' };
    }
    prepared.push({ type: 'file', mimeType, base64: Buffer.from(part.data).toString('base64') });
    summary.push({ type: part.type, bytes, sha256: createHash('sha256').update(part.data).digest('hex') });
  }

  return { ok: true, prepared, summary };
};
