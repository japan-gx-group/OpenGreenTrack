// IDEA Excel の署名付きアップロード URL 発行（docs/idea-scope3-spec.md §4.1）。
// ブラウザは API にファイル本体を送らず、ここで発行した署名付き URL で Supabase Storage の
// upload-quarantine バケットへ直接アップロードし、そのパスを POST /api/idea-imports に渡す。
// リクエストボディ制限のあるホスティング（Vercel の 4.5MB 等）でも数十MBの xlsx を取り込めるようにするため。
//
// - 発行するパスはログイン済みユーザーの自組織フォルダ配下（`${organizationId}/idea-imports/<uuid>.xlsx`）に
//   限定する。利用者の入力（ファイル名）はパスに使わない
// - upload-quarantine はブラウザ向けの select / delete ポリシーを持たない（20260831000003_storage.sql）。
//   署名付き URL は service_role が発行するため RLS を介さず、この Route Handler の認証が唯一のガード
// - ファイル名・サイズの申告値で拡張子違い・サイズ超過を先に弾く（数十MBを上げた後に失敗させない）。
//   実バイト列の検証は取込 API 側で改めて行う
// - 進行中の取込がある組織には発行しない（数十MBを上げてから取込 API で 409 になる無駄を避ける）
// - 発行回数を組織単位でレート制限する（発行だけ繰り返して Storage を 50MB ずつ埋める使い方を止める）
// - 発行のついでに、自組織フォルダに取り残された古いファイル（アップロード後に取込 API が呼ばれなかった等）
//   を応答後に削除する。スケジューラを持たずにホスティングを問わず掃除するため

import { NextResponse, after } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import {
  IDEA_IMPORT_PROCESSING_MESSAGE,
  IDEA_UPLOAD_BUCKET,
  IDEA_UPLOAD_URL_RATE_LIMIT,
  buildIdeaUploadPath,
  consumeIdeaUploadUrlQuota,
  hasProcessingIdeaImport,
  recoverStaleIdeaImports,
  removeStaleIdeaUploadFiles,
  validateIdeaImportFileMeta,
} from '@/features/factors/services/ideaImportServer';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

interface UploadUrlRequestBody {
  fileName: string;
  fileSize: number;
}

export const POST = async (request: Request) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  let body: Partial<UploadUrlRequestBody> | null = null;
  try {
    const parsed: unknown = await request.json();
    if (parsed !== null && typeof parsed === 'object') body = parsed as Partial<UploadUrlRequestBody>;
  } catch {
    body = null;
  }
  if (!body || typeof body.fileName !== 'string' || typeof body.fileSize !== 'number') {
    return NextResponse.json(
      { error: 'JSON で fileName / fileSize を送信してください' },
      { status: 400 },
    );
  }

  const validation = validateIdeaImportFileMeta(body.fileName, body.fileSize);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errorMessage }, { status: 400 });
  }

  if (!consumeIdeaUploadUrlQuota(profile.organizationId)) {
    return NextResponse.json(
      { error: 'アップロードの開始回数が上限に達しました。しばらく待ってから再度お試しください' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(IDEA_UPLOAD_URL_RATE_LIMIT.windowMs / 1000)) },
      },
    );
  }

  try {
    const supabase = createAdminClient();

    // 進行中の取込があれば、数十MBをアップロードする前に 409 で返す（滞留行の回収を先に行う）。
    await recoverStaleIdeaImports(supabase, profile.organizationId, log);
    if (await hasProcessingIdeaImport(supabase, profile.organizationId)) {
      return NextResponse.json({ error: IDEA_IMPORT_PROCESSING_MESSAGE }, { status: 409 });
    }

    // 取り残しファイルの掃除は応答後に行う（結果は発行に影響しない。失敗は内部でログに残す）。
    after(() => removeStaleIdeaUploadFiles(supabase, profile.organizationId, log));

    const storagePath = buildIdeaUploadPath(profile.organizationId);
    const { data, error } = await supabase.storage
      .from(IDEA_UPLOAD_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      log.error({ error }, '署名付きアップロードURLの発行に失敗しました');
      return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
    }

    // signedUrl 自体は返さない: ブラウザは supabase-js の uploadToSignedUrl(path, token) で
    // アップロードする（バケット名・パス・トークンだけで足りる）。
    return NextResponse.json({ bucket: IDEA_UPLOAD_BUCKET, storagePath: data.path, token: data.token });
  } catch (error) {
    log.error({ error }, '予期しないエラー');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
