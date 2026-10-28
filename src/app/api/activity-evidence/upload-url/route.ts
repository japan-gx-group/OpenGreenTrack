// 活動量の帳票の署名付きアップロード URL の発行（POST）。
// ブラウザは API にファイル本体を送らず、ここで発行した URL で upload-quarantine へ直接上げ、そのパスを
// POST /api/activity-evidence に渡す（リクエストボディの上限があるホスティングでも 10MB の帳票を上げるため）。
//
// - 全メンバーが呼べる（データ入力は全員が使えるため）。発行先はログイン中の組織のフォルダに限る
// - upload-quarantine にはブラウザ向けのポリシーが無い。URL は service_role が発行するので、この Route Handler の
//   認証が唯一のガード
// - ファイル名・大きさの申告値で先に弾く。中身は POST /api/activity-evidence で改めて確かめる
// - 発行の回数を組織ごとに抑え、ついでに取り残された古い一時ファイルを応答の後に消す

import { NextResponse, after } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { SIGNED_OUT_MESSAGE } from '@/lib/authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import {
  EVIDENCE_QUARANTINE_BUCKET,
  EVIDENCE_UPLOAD_URL_RATE_LIMIT,
  consumeEvidenceUploadUrlQuota,
  createEvidenceUploadUrl,
  removeStaleEvidenceUploads,
  validateEvidenceFileMeta,
} from '@/features/activity-evidence/services/evidenceServer';

export const runtime = 'nodejs';

export const POST = async (request: Request) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const { fileName, fileSize } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof fileName !== 'string' || typeof fileSize !== 'number') {
    return NextResponse.json({ error: 'JSON で fileName / fileSize を送信してください' }, { status: 400 });
  }
  const validation = validateEvidenceFileMeta(fileName, fileSize);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errorMessage }, { status: 400 });
  }

  if (!consumeEvidenceUploadUrlQuota(profile.organizationId)) {
    return NextResponse.json(
      { error: '帳票のアップロードが続いています。しばらく待ってから再度お試しください' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(EVIDENCE_UPLOAD_URL_RATE_LIMIT.windowMs / 1000)) } },
    );
  }

  const admin = createAdminClient();
  after(() => removeStaleEvidenceUploads(admin, profile.organizationId, log));
  const result = await createEvidenceUploadUrl(admin, profile.organizationId);
  if (!result.ok) {
    log.error({ error: result.error }, '帳票の署名付きアップロード URL の発行に失敗しました');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
  // signedUrl は返さない。ブラウザは supabase-js の uploadToSignedUrl(path, token) で上げる。
  return NextResponse.json({ bucket: EVIDENCE_QUARANTINE_BUCKET, storagePath: result.storagePath, token: result.token });
};
