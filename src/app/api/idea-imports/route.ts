// IDEA Excel 取込の実行トリガー（docs/idea-scope3-spec.md §4.1）。
// multipart でファイル・GWPモデル・ライセンス確認を受け取り、idea_imports 行を
// processing / isActive=false で作成して 202 を返す。パース〜取込本体は応答後に
// 非同期実行され、ブラウザは idea_imports 行をポーリングして進捗・結果を取得する
// （即時レスポンス + バックグラウンド処理のパターン）。
//
// 認証ガード（/api/calculations と同方針）:
//   取込はサーバ側で service_role を使うため、呼び出し元をここで検証する。
//   ログイン済みユーザーの自組織に対してのみ取込を作成する。
//   ロールによる絞り込みは行わない（ロール判定は無効）。設計書 §3.2 の
//   「admin ロールを検証」は実装と一致しないため、意図的に採用しない。
//
// ⚠️ デプロイ前提: IDEA Excel は数十MBになり得るため、リクエストボディ制限のある
//   ホスティング（Vercel の 4.5MB 等）ではこの API は動かない。セルフホスト
//   （またはボディ制限を設定できる環境）を前提とする（§4.1。README / docs/setup-guide.md）。

import { NextResponse, after } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { IDEA_GWP_MODEL_OPTIONS } from '@/features/factors/services/ideaImport';
import {
  IDEA_IMPORT_MAX_FILE_SIZE_BYTES,
  processIdeaImport,
  validateIdeaImportFile,
} from '@/features/factors/services/ideaImportServer';

// service_role と exceljs（Node バッファ前提）を使うため Node ランタイム必須。
export const runtime = 'nodejs';

// 進行中とみなす取込の滞留窓。プロセス中断等で processing のまま残った行は
// この時間を過ぎたら failed に回収し、新しい取込をブロックし続けないようにする
// （取込本体は数十秒オーダーで完了する）。
const IDEA_IMPORT_STALE_MS = 10 * 60 * 1000;

// Content-Length 事前チェックで multipart の境界・他フィールド（gwpModel 等）ぶんとして
// 上限に足す余裕。ファイル本体以外の multipart オーバーヘッドは数百バイトなので 64KiB あれば十分。
const IDEA_IMPORT_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const GWP_MODEL_VALUES: readonly string[] = IDEA_GWP_MODEL_OPTIONS.map((option) => option.value);

const PROCESSING_CONFLICT_RESPONSE = () =>
  NextResponse.json(
    { error: 'IDEAデータベースの取込が進行中です。完了後に再度お試しください' },
    { status: 409 },
  );

/**
 * 組織に processing の取込が残っているか。
 * 排他の正本は部分一意インデックス idea_imports_one_processing_per_org（20260907000000_review_fixes.sql）で、
 * 確認〜INSERT の間に別リクエストが割り込んでも INSERT が 23505 で失敗し 409 になる。
 * ここは数十 MB のボディを読む前に分かりやすい 409 を返すための入口チェック。
 */
const hasProcessingImport = async (
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<boolean> => {
  const { data, error } = await supabase
    .from('idea_imports')
    .select('id')
    .eq('organizationId', organizationId)
    .eq('status', 'processing')
    .limit(1);
  if (error) {
    throw new Error(`進行中インポートの確認に失敗しました: ${error.message}`);
  }
  return (data ?? []).length > 0;
};

export const POST = async (request: Request) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  // request.formData() はボディ全体をメモリに載せてから validateIdeaImportFile でサイズ超過を
  // 弾くため、ヘッダの時点で明らかに上限を超えているものはボディを読む前に拒否する
  // （数十MB超のアップロードをメモリに積まずに済む）。ヘッダが無い・不正な場合は本体側の検証に任せる。
  const declaredLength = Number(request.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > IDEA_IMPORT_MAX_FILE_SIZE_BYTES + IDEA_IMPORT_MULTIPART_OVERHEAD_BYTES
  ) {
    return NextResponse.json(
      { error: 'ファイルサイズが上限（50MB）を超えています' },
      { status: 413 },
    );
  }

  try {
    const supabase = createAdminClient();

    // 入口チェック①: 既に進行中なら、数十MBのボディを読み込む前に 409 で返す。
    if (await hasProcessingImport(supabase, profile.organizationId)) {
      return PROCESSING_CONFLICT_RESPONSE();
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'multipart/form-data でファイルを送信してください' },
        { status: 400 },
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file（IDEAのxlsxファイル）が必要です' }, { status: 400 });
    }

    // ライセンス確認（§4.1-1 の確認チェック）はクライアント表示だけでなくサーバ側でも要求する。
    if (formData.get('licenseConfirmed') !== 'true') {
      return NextResponse.json(
        { error: 'SuMPOとのライセンス契約の確認が必要です' },
        { status: 400 },
      );
    }

    const gwpModel = formData.get('gwpModel');
    if (typeof gwpModel !== 'string' || !GWP_MODEL_VALUES.includes(gwpModel)) {
      return NextResponse.json({ error: '対応していないGWPモデルです' }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const validation = validateIdeaImportFile(file.name, fileBuffer);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.errorMessage }, { status: 400 });
    }

    // 滞留した processing 行の回収（中断された取込が新規取込を恒久ブロックしないように）。
    const staleBefore = new Date(Date.now() - IDEA_IMPORT_STALE_MS).toISOString();
    const { error: staleError } = await supabase
      .from('idea_imports')
      .update({
        status: 'failed',
        errorMessage: '取込が完了しないまま中断された可能性があります。再度取り込んでください',
      })
      .eq('organizationId', profile.organizationId)
      .eq('status', 'processing')
      .lt('updatedAt', staleBefore);
    if (staleError) {
      // housekeeping の失敗は取込自体を止めない（進行中チェックで再度弾かれるだけ）。
      log.warn({ error: staleError }, '滞留インポートの回収に失敗しました');
    }

    // 入口チェック②: ボディの読み込み・解析中に別リクエストが先に INSERT した場合を拾う。
    // 確認〜INSERT の窓に割り込まれた場合は INSERT の 23505 で捕捉する（下記）。
    if (await hasProcessingImport(supabase, profile.organizationId)) {
      return PROCESSING_CONFLICT_RESPONSE();
    }

    // §4.1-3: processing / isActive=false で作成する（true で作ると旧 active 行と
    // 部分一意インデックスが衝突し、2回目以降の取込が INSERT 時点で必ず失敗する）。
    // version / citationText はパース完了時に確定するため、作成時は空文字で埋める。
    const { data: importRow, error: insertError } = await supabase
      .from('idea_imports')
      .insert({
        organizationId: profile.organizationId,
        version: '',
        gwpModel,
        citationText: '',
        fileName: file.name.slice(0, 300),
        status: 'processing',
        isActive: false,
        importedByUserId: profile.id,
      })
      .select('id')
      .single();
    if (insertError?.code === '23505') {
      // idea_imports_one_processing_per_org: 確認〜INSERT の間に別リクエストが先に processing を作った
      return PROCESSING_CONFLICT_RESPONSE();
    }
    if (insertError || !importRow) {
      log.error({ error: insertError }, 'インポート記録の作成に失敗しました');
      return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
    }

    const importId = importRow.id as string;

    // 取込本体（パース → チャンク挿入 → 完了処理 RPC）は応答を返した後に実行する。
    after(() =>
      processIdeaImport({
        importId,
        organizationId: profile.organizationId,
        fileBuffer,
        gwpModel,
        log: log.child({ component: 'processIdeaImport' }),
      }),
    );

    return NextResponse.json({ importId }, { status: 202 });
  } catch (error) {
    // 生の DB エラーを呼び出し元へ返さないよう、詳細はサーバーログにのみ残す。
    log.error({ error }, '予期しないエラー');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
