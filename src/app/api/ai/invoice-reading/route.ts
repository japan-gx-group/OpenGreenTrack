// 請求書の AI 読取り（POST）。データ入力の「請求書から読み取る」から呼ぶ。
//
// 全メンバーが呼べる（データ入力は全員が使えるため）。ログイン中のプロフィールの組織で読み、組織 ID はリクエストから
// 受け取らない。ファイルは multipart/form-data の file で 1 つだけ受け取り、保存しない（AI に直接送る）。
// 本体は src/features/invoice-reading/services/readInvoice.ts。失敗の理由はサーバのログにだけ残し、画面には決まった文を返す。

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { SIGNED_OUT_MESSAGE } from '@/lib/authz';
import { readInvoice } from '@/features/invoice-reading/services/readInvoice';
import { MAX_INVOICE_FILE_BYTES } from '@/features/invoice-reading/types';
import type { AiGenerateErrorCode } from '@/types/ai';

export const runtime = 'nodejs';
// 読取りと係数の判定で AI を 2 回呼ぶ（提供元の呼び出しは 1 回 60 秒で打ち切る: GENERATE_TIMEOUT_MS）。
export const maxDuration = 180;

const FILE_REQUIRED_MESSAGE = '請求書のファイル（PDF・PNG・JPEG・WebP）を 1 つ選んでください';
const FILE_TOO_LARGE_MESSAGE = 'ファイルが大きすぎます。4MB 以下にしてください';
/** multipart の区切りなどの分。本文全体がこれを超えたら、ファイルを読む前に断る */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const STATUS_BY_CODE: Partial<Record<AiGenerateErrorCode | 'load_failed', number>> = {
  invalid_input: 400,
  not_configured: 409,
  model_not_selected: 409,
  limit_exceeded: 429,
  rate_limited: 429,
  load_failed: 500,
};

export const POST = async (request: NextRequest) => {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_INVOICE_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: FILE_TOO_LARGE_MESSAGE }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: FILE_REQUIRED_MESSAGE }, { status: 400 });
  }
  if (file.size > MAX_INVOICE_FILE_BYTES) {
    return NextResponse.json({ error: FILE_TOO_LARGE_MESSAGE }, { status: 413 });
  }

  const result = await readInvoice({
    profile,
    file: new Uint8Array(await file.arrayBuffer()),
    // 画面の案内と備考に使う名前。長すぎる・改行を含む名前はそろえる。
    fileName: file.name.replace(/\s+/g, ' ').trim().slice(0, 100) || '請求書',
    signal: request.signal,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      {
        status: STATUS_BY_CODE[result.code] ?? 502,
        headers: result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : undefined,
      },
    );
  }
  return NextResponse.json(result.result);
};
