// IDEA Excel 取込の実行トリガー（docs/idea-scope3-spec.md §4.1）。
// ブラウザが Supabase Storage（upload-quarantine）へ直接アップロードした xlsx のパスと、
// GWPモデル・ライセンス確認を JSON で受け取り、idea_imports 行を processing / isActive=false で
// 作成して 202 を返す。パース〜取込本体は応答後に非同期実行され、ブラウザは idea_imports 行を
// ポーリングして進捗・結果を取得する（即時レスポンス + バックグラウンド処理のパターン）。
//
// ファイル本体を API に送らない理由: IDEA Excel は数十MBになり、リクエストボディ制限のある
// ホスティング（Vercel の 4.5MB 等）ではアップロード自体が失敗するため。署名付きアップロード URL
// の発行は /api/idea-imports/upload-url が行う。ここでは受け取ったパスが自組織向けに発行した形か
// を検証し、Storage から取得した実バイト列を検証（拡張子・サイズ・ZIP マジックナンバー）してから
// 取込に回す。取込の完了・失敗・入力不備のいずれでも quarantine のファイルは削除する。
//
// 認証ガード（/api/calculations と同方針）:
//   取込はサーバ側で service_role を使うため、呼び出し元をここで検証する。
//   ログイン済みユーザーの自組織に対してのみ取込を作成する。
//   ロールによる絞り込みは行わない（ロール判定は無効）。設計書 §3.2 の
//   「admin ロールを検証」は実装と一致しないため、意図的に採用しない。
//
// 後片付け: storagePath の組織チェックを通った後は、202 で取込本体へ引き渡す場合を除き、どの経路で
//   抜けても（例外を含む）finally で quarantine のファイルを削除する。
//
// デプロイ前提: リクエストボディは JSON 数百バイトなのでボディ制限のあるホスティングでも動く。
//   xlsx の読み取りはストリーミング（対象シートの行だけを逐次処理）で、ヒープはファイルサイズ +
//   数十MB程度に収まる（docs/setup-guide.md 2-F に実測値）。

import { NextResponse, after } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { IDEA_GWP_MODEL_OPTIONS } from '@/features/factors/services/ideaImport';
import {
  IDEA_IMPORT_PROCESSING_MESSAGE,
  downloadIdeaUploadFile,
  hasProcessingIdeaImport,
  isIdeaUploadPathForOrganization,
  processIdeaImport,
  recoverStaleIdeaImports,
  removeIdeaUploadFile,
  validateIdeaImportFile,
} from '@/features/factors/services/ideaImportServer';

// service_role と exceljs（Node ストリーム前提）を使うため Node ランタイム必須。
export const runtime = 'nodejs';

/** idea_imports.fileName の列幅（varchar(300)） */
const FILE_NAME_MAX_LENGTH = 300;

const GWP_MODEL_VALUES: readonly string[] = IDEA_GWP_MODEL_OPTIONS.map((option) => option.value);

const PROCESSING_CONFLICT_RESPONSE = () =>
  NextResponse.json({ error: IDEA_IMPORT_PROCESSING_MESSAGE }, { status: 409 });

/** リクエストボディ（JSON）。ファイル本体は含まない */
interface IdeaImportRequestBody {
  /** /api/idea-imports/upload-url が発行した Storage パス */
  storagePath: string;
  /** 利用者が選択した元のファイル名（表示用。拡張子の検証にも使う） */
  fileName: string;
  gwpModel: string;
  licenseConfirmed: boolean;
}

const parseRequestBody = async (request: Request): Promise<Partial<IdeaImportRequestBody> | null> => {
  try {
    const body: unknown = await request.json();
    if (body === null || typeof body !== 'object') return null;
    return body as Partial<IdeaImportRequestBody>;
  } catch {
    return null;
  }
};

export const POST = async (request: Request) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const body = await parseRequestBody(request);
  if (!body) {
    return NextResponse.json(
      { error: 'JSON で storagePath / fileName / gwpModel / licenseConfirmed を送信してください' },
      { status: 400 },
    );
  }

  const { storagePath, fileName, gwpModel, licenseConfirmed } = body;
  // 自組織向けに発行したパス以外（他組織のフォルダ・任意パス）は、Storage に触れる前に拒否する。
  // storage.objects の RLS は service_role には効かないため、この検証が組織分離の要（§3.2）。
  // ここで弾いた場合は他人のファイルかもしれないので削除もしない。
  if (typeof storagePath !== 'string' || !isIdeaUploadPathForOrganization(storagePath, profile.organizationId)) {
    return NextResponse.json({ error: 'アップロード先の指定が不正です' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // ここから先は quarantine に自組織のファイルが置かれている前提。202 で取込本体へ引き渡した場合を除き、
  // 400 / 409 / 500 のどの経路（例外を含む）で抜けても finally でファイルを削除し、残置させない
  // （ライセンスデータのため。§0.1）。置かれていないと分かった場合だけ削除を省く。
  let discardUpload = true;
  try {
    if (typeof fileName !== 'string' || fileName.trim() === '') {
      return NextResponse.json({ error: 'fileName（IDEAのxlsxファイル名）が必要です' }, { status: 400 });
    }

    // ライセンス確認（§4.1-1 の確認チェック）はクライアント表示だけでなくサーバ側でも要求する。
    if (licenseConfirmed !== true) {
      return NextResponse.json({ error: 'SuMPOとのライセンス契約の確認が必要です' }, { status: 400 });
    }

    if (typeof gwpModel !== 'string' || !GWP_MODEL_VALUES.includes(gwpModel)) {
      return NextResponse.json({ error: '対応していないGWPモデルです' }, { status: 400 });
    }

    // 滞留した processing 行の回収を先に行う（進行中チェックより後だと、中断された取込の行が
    // 409 を出し続けて回収に到達できず、組織が永久に取込できなくなる）。
    await recoverStaleIdeaImports(supabase, profile.organizationId, log);

    // 入口チェック: 既に進行中なら、Storage からファイルを取得する前に 409 で返す。
    // 確認〜INSERT の窓に割り込まれた場合は INSERT の 23505 で捕捉する（下記）。
    if (await hasProcessingIdeaImport(supabase, profile.organizationId)) {
      return PROCESSING_CONFLICT_RESPONSE();
    }

    const download = await downloadIdeaUploadFile(supabase, storagePath);
    if (!download.ok) {
      if (download.reason === 'not_found') {
        discardUpload = false;
        return NextResponse.json(
          { error: 'アップロードされたファイルが見つかりません。もう一度ファイルを選択してください' },
          { status: 400 },
        );
      }
      if (download.reason === 'too_large') {
        return NextResponse.json({ error: 'ファイルサイズが上限（50MB）を超えています' }, { status: 400 });
      }
      log.error({ error: download.error, storagePath }, 'アップロードされたファイルの取得に失敗しました');
      return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
    }
    const fileBuffer = download.buffer;
    const validation = validateIdeaImportFile(fileName, fileBuffer);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.errorMessage }, { status: 400 });
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
        fileName: fileName.trim().slice(0, FILE_NAME_MAX_LENGTH),
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
    // 完了・失敗のどちらでも quarantine のファイルを削除する（残置させない）。
    after(async () => {
      try {
        await processIdeaImport({
          importId,
          organizationId: profile.organizationId,
          fileBuffer,
          gwpModel,
          log: log.child({ component: 'processIdeaImport' }),
        });
      } finally {
        await removeIdeaUploadFile(supabase, storagePath, log);
      }
    });
    discardUpload = false;

    return NextResponse.json({ importId }, { status: 202 });
  } catch (error) {
    // 生の DB エラーを呼び出し元へ返さないよう、詳細はサーバーログにのみ残す。
    log.error({ error }, '予期しないエラー');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  } finally {
    if (discardUpload) {
      await removeIdeaUploadFile(supabase, storagePath, log);
    }
  }
};
