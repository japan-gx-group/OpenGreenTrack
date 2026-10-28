// 請求書の AI 読取り（POST）。データ入力の「請求書から読み取る」から呼ぶ。
//
// 全メンバーが呼べる（データ入力は全員が使えるため）。読むのは保存済みの帳票（activity_evidence_files）で、
// JSON で帳票の ID を受け取り、ログイン中の人のセッションで帳票の行と Storage のファイルを読む（RLS と
// import_files_select_own_organization で自組織の帳票に限る）。組織 ID はリクエストから受け取らない。
// 帳票は先に POST /api/activity-evidence で保存しておく（AI を使わなくても記録の根拠として残すため）。
// 本体は src/features/invoice-reading/services/readInvoice.ts。失敗の理由はサーバのログにだけ残し、画面には決まった文を返す。

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { SIGNED_OUT_MESSAGE } from '@/lib/authz';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { createClient } from '@/lib/supabase/server';
import { readInvoice } from '@/features/invoice-reading/services/readInvoice';
import { MAX_INVOICE_FILE_BYTES } from '@/features/invoice-reading/types';
import type { EvidenceFile } from '@/features/activity-evidence/types';
import type { AiGenerateErrorCode } from '@/types/ai';

export const runtime = 'nodejs';
// 読取りと係数の判定で AI を 2 回呼ぶ（提供元の呼び出しは 1 回 60 秒で打ち切る: GENERATE_TIMEOUT_MS）。
export const maxDuration = 180;

const EVIDENCE_BUCKET = 'import-files';
const EVIDENCE_SELECT = 'id, fileName, mimeType, sizeBytes, convertedFrom, storagePath, createdAt, uploadedBy';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_BY_CODE: Partial<Record<AiGenerateErrorCode | 'load_failed', number>> = {
  invalid_input: 400,
  not_configured: 409,
  model_not_selected: 409,
  limit_exceeded: 429,
  rate_limited: 429,
  load_failed: 500,
};

export const POST = async (request: NextRequest) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const evidenceFileId = typeof body === 'object' && body !== null ? (body as { evidenceFileId?: unknown }).evidenceFileId : null;
  if (typeof evidenceFileId !== 'string' || !UUID.test(evidenceFileId)) {
    return NextResponse.json({ error: 'JSON で evidenceFileId（読み取る帳票）を送信してください' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: evidence, error } = await supabase
    .from('activity_evidence_files')
    .select(EVIDENCE_SELECT)
    .eq('id', evidenceFileId)
    .maybeSingle();
  if (error) {
    log.error({ error }, '読み取る帳票の取得に失敗しました');
    return NextResponse.json({ error: '帳票を読み込めませんでした。時間をおいて再度お試しください' }, { status: 500 });
  }
  if (!evidence) {
    return NextResponse.json({ error: '帳票が見つかりません' }, { status: 404 });
  }
  const file = evidence as EvidenceFile;
  if (Number(file.sizeBytes) > MAX_INVOICE_FILE_BYTES) {
    return NextResponse.json(
      { error: '4MB を超える帳票は AI では読めません（帳票は保存されています）。手で入力してください' },
      { status: 400 },
    );
  }

  const { data: blob, error: downloadError } = await supabase.storage.from(EVIDENCE_BUCKET).download(file.storagePath);
  if (downloadError || !blob) {
    log.error({ error: downloadError }, '読み取る帳票のファイルを読めませんでした');
    return NextResponse.json({ error: '帳票を読み込めませんでした。時間をおいて再度お試しください' }, { status: 500 });
  }

  const result = await readInvoice({
    profile,
    file: new Uint8Array(await blob.arrayBuffer()),
    evidence: { ...file, sizeBytes: Number(file.sizeBytes) },
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
