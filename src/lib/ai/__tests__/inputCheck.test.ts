import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { detectFileMimeType, prepareAiInputs } from '../inputCheck';
import type { AiPurpose } from '../purposes';
import { GIF_BYTES, JPEG_BYTES, PDF_BYTES, PNG_BYTES, WEBP_BYTES } from './testFiles';

const purpose: AiPurpose = {
  label: 'テスト',
  inputs: ['text', 'pdf', 'image'],
  maxInputBytes: 1024,
  limits: { perMinute: 5, perDay: 100 },
  maxOutputTokens: 1000,
};

describe('detectFileMimeType', () => {
  it('先頭のバイトで PDF・PNG・JPEG・WebP を判定する', () => {
    expect(detectFileMimeType(PDF_BYTES)).toBe('application/pdf');
    expect(detectFileMimeType(PNG_BYTES)).toBe('image/png');
    expect(detectFileMimeType(JPEG_BYTES)).toBe('image/jpeg');
    expect(detectFileMimeType(WEBP_BYTES)).toBe('image/webp');
  });

  it('対応していない形式・短すぎる中身は null', () => {
    expect(detectFileMimeType(GIF_BYTES)).toBeNull();
    expect(detectFileMimeType(new Uint8Array([0x25, 0x50]))).toBeNull();
    expect(detectFileMimeType(new Uint8Array())).toBeNull();
  });
});

describe('prepareAiInputs', () => {
  it('提供元へ渡す形（base64）と、監査ログ用の要約（種類・バイト数・SHA-256）を作る', () => {
    const result = prepareAiInputs(purpose, [
      { type: 'pdf', data: PDF_BYTES },
      { type: 'text', text: '補足' },
    ]);
    expect(result).toEqual({
      ok: true,
      prepared: [
        { type: 'file', mimeType: 'application/pdf', base64: Buffer.from(PDF_BYTES).toString('base64') },
        { type: 'text', text: '補足' },
      ],
      summary: [
        { type: 'pdf', bytes: PDF_BYTES.byteLength, sha256: createHash('sha256').update(PDF_BYTES).digest('hex') },
        { type: 'text', bytes: Buffer.byteLength('補足', 'utf8') },
      ],
    });
  });

  it('PDF として渡された画像・画像として渡された PDF は断る（中身で判定する）', () => {
    expect(prepareAiInputs(purpose, [{ type: 'pdf', data: PNG_BYTES }])).toEqual({
      ok: false,
      reason: 'PDF のファイルではありません',
    });
    expect(prepareAiInputs(purpose, [{ type: 'image', data: PDF_BYTES }])).toEqual({
      ok: false,
      reason: 'PNG・JPEG・WebP の画像ではありません',
    });
    expect(prepareAiInputs(purpose, [{ type: 'image', data: GIF_BYTES }])).toMatchObject({ ok: false });
  });

  it('用途で許していない種類は断る', () => {
    const textOnly: AiPurpose = { ...purpose, inputs: ['text'] };
    expect(prepareAiInputs(textOnly, [{ type: 'image', data: PNG_BYTES }])).toEqual({
      ok: false,
      reason: 'この用途では image を送れません',
    });
  });

  it('合計の量が上限を超えたら断る（文字は UTF-8 のバイト数で数える）', () => {
    const small: AiPurpose = { ...purpose, maxInputBytes: 10 };
    expect(prepareAiInputs(small, [{ type: 'text', text: 'あいうえ' }])).toEqual({
      ok: false,
      reason: '送る量が上限を超えています',
    });
  });

  it('入力が空なら断る', () => {
    expect(prepareAiInputs(purpose, [])).toEqual({ ok: false, reason: '入力がありません' });
  });
});
