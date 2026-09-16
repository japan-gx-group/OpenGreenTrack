// IDEA Excel 取込ジョブの本体処理（docs/idea-scope3-spec.md §4.1）。
// Route Handler（/api/idea-imports）の応答後に非同期で実行され、idea_imports 行へ
// 進捗と結果を書き込む。ブラウザはこの行をポーリングして進捗・結果を取得する
// （受付だけ先に返し、本体はバックグラウンドで進めるパターン）。
//
// ファイルの受け渡し: ブラウザは API にファイル本体を送らず、署名付きアップロード URL
// （/api/idea-imports/upload-url が service_role で発行）で Supabase Storage の
// upload-quarantine バケットへ直接置く。API はそのパスだけを受け取り、ここで Storage から
// 取得して検証・取込し、完了・失敗のいずれでも quarantine から削除する（残置させない）。
// ブラウザからの直接 select / delete ポリシーは置かない（20260831000003_storage.sql の方針）。
//
// ⚠️ サーバ専用: service_role の管理クライアントを使うため、Route Handler からのみ import
//   すること。認証・組織の検証は呼び出し元（Route Handler）で完了している前提。
//
// 完了処理（completed 化 → 旧 active の false 化 → 新 active 化 → 未算定レコードの
// ideaCode 再マッピング）は supabase-js では複数文トランザクションを組めないため、
// service_role 限定の RPC complete_idea_import（supabase/migrations/20260831000002_rpc.sql）に
// 委ねる（§3.6・§4.1-3。isActive の切替順は逆にできない）。
// 失敗時は failed + 部分挿入行の削除を行い、旧 active インポートには触れない
// （運用中の検索・算定を止めない。§4.1）。

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger as baseLogger } from '@/lib/logging/logger';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';
import type { Logger } from 'pino';
import { formatIdeaParseErrors, type IdeaParsedMeta, type IdeaParsedRow } from './ideaImport';
import { readIdeaWorkbookStream } from './ideaImportReader';

/** idea_factors への一括 INSERT のチャンクサイズ（§4.1。約1万行を 500 行ずつ挿入する） */
export const IDEA_FACTOR_INSERT_CHUNK_SIZE = 500;

/**
 * IDEA インポート RPC が使うカスタム SQLSTATE（apiRateLimit.ts の HEAVY_API_SQLSTATE と
 * 同じ方式。正本は supabase/migrations/20260831000002_rpc.sql の complete_idea_import /
 * delete_idea_import — 変更時は両方を揃えること）。
 */
export const IDEA_IMPORT_SQLSTATE = {
  /** 対象インポートが存在しない・組織不一致・状態不正 */
  importInvalid: 'P2031',
  /** emission_results から参照されているため削除不可（§3.6-4） */
  importReferenced: 'P2032',
} as const;

/**
 * 取込ファイルの上限サイズ。IDEA Excel は数十MBになるため 50MiB
 * （upload-quarantine バケットの file_size_limit と同値。20260831000003_storage.sql）
 */
export const IDEA_IMPORT_MAX_FILE_SIZE_BYTES = 52_428_800;

/** ブラウザが直接アップロードする一時置き場のバケット（20260831000003_storage.sql §1） */
export const IDEA_UPLOAD_BUCKET = 'upload-quarantine';

/** 組織フォルダ直下のサブフォルダ。他の取込機能を再導入したときにパスが衝突しないようにする */
const IDEA_UPLOAD_FOLDER = 'idea-imports';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * 署名付きアップロード URL を発行する Storage パスを組み立てる。
 * 先頭フォルダ = organizationId（storage.objects の組織分離と同じ規約）。ファイル名は
 * 利用者の入力を使わず UUID にする（パス・トラバーサルや他組織のパス指定を構造的に排除する）。
 */
export const buildIdeaUploadPath = (organizationId: string, uploadId: string = randomUUID()): string =>
  `${organizationId}/${IDEA_UPLOAD_FOLDER}/${uploadId}.xlsx`;

/**
 * 取込 API が受け取った storagePath が、その組織向けに buildIdeaUploadPath で発行した形か。
 * 他組織のパス・任意パスの指定は false（取込を拒否する。RLS はここでは効かない）。
 */
export const isIdeaUploadPathForOrganization = (
  storagePath: string,
  organizationId: string,
): boolean => {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return false;
  const pattern = new RegExp(`^${organizationId}/${IDEA_UPLOAD_FOLDER}/${UUID_PATTERN}\\.xlsx$`, 'i');
  return pattern.test(storagePath);
};

/**
 * ファイル名・サイズだけの事前検証（純関数）。署名付き URL の発行前にブラウザ申告の値で
 * 弾き、数十MBのアップロード後に拡張子違いで失敗する無駄を避ける。
 * 申告値は信用せず、取込 API 側で Storage から取得した実バイト列を validateIdeaImportFile で再検証する。
 */
export const validateIdeaImportFileMeta = (
  fileName: string,
  fileSize: number,
): { ok: true } | { ok: false; errorMessage: string } => {
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { ok: false, errorMessage: 'ファイルが空です' };
  }
  if (fileSize > IDEA_IMPORT_MAX_FILE_SIZE_BYTES) {
    return { ok: false, errorMessage: 'ファイルサイズが上限（50MB）を超えています' };
  }
  const ext = fileName.trim().toLowerCase().split('.').pop();
  if (ext !== 'xlsx') {
    return { ok: false, errorMessage: 'xlsx形式のIDEAファイルを選択してください' };
  }
  return { ok: true };
};

/**
 * 取込ファイルの事前検証（純関数）。xlsx（ZIPコンテナ）以外・サイズ超過を弾く。
 * 中身の構造検証はパース時に行うため、ここでは形式だけを確認する。
 */
export const validateIdeaImportFile = (
  fileName: string,
  buffer: Uint8Array,
): { ok: true } | { ok: false; errorMessage: string } => {
  const metaValidation = validateIdeaImportFileMeta(fileName, buffer.byteLength);
  if (!metaValidation.ok) return metaValidation;
  // xlsx は ZIP コンテナ（先頭 'PK\x03\x04'）。拡張子偽装の平文ファイル等を入口で弾く。
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    return { ok: false, errorMessage: 'xlsx形式ではないファイルです（内容がExcelファイルではありません）' };
  }
  return { ok: true };
};

/** 進行中の取込がある組織への応答文言（取込 API・URL 発行 API で共通） */
export const IDEA_IMPORT_PROCESSING_MESSAGE =
  'IDEAデータベースの取込が進行中です。完了後に再度お試しください';

/**
 * 組織に processing の取込が残っているか。
 * 排他の正本は部分一意インデックス idea_imports_one_processing_per_org で、確認〜INSERT の間に
 * 別リクエストが割り込んでも INSERT が 23505 で失敗する。ここは「数十MBをアップロードする前」
 * 「Storage からファイルを取得する前」に分かりやすい 409 を返すための入口チェック。
 * 呼び出し側は先に滞留行の回収（recoverStaleIdeaImports）を済ませること。
 */
export const hasProcessingIdeaImport = async (
  supabase: SupabaseClient,
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

/**
 * 進行中とみなす取込の滞留窓。プロセス中断等で processing のまま残った行はこの時間を過ぎたら
 * failed に回収し、新しい取込をブロックし続けないようにする（取込本体は数十秒〜数分で完了する）。
 */
export const IDEA_IMPORT_STALE_MS = 10 * 60 * 1000;

/**
 * 滞留した processing 行を failed に回収する。進行中チェックより**前**に呼ぶこと。
 * 後に回すと、中断された取込の行が 409 を出し続けて回収に到達できず、組織が永久に取込できなくなる。
 * 失敗しても取込は止めない（進行中チェックで弾かれるだけ）。
 */
export const recoverStaleIdeaImports = async (
  supabase: SupabaseClient,
  organizationId: string,
  log: Logger,
  now: number = Date.now(),
): Promise<void> => {
  const staleBefore = new Date(now - IDEA_IMPORT_STALE_MS).toISOString();
  const { error } = await supabase
    .from('idea_imports')
    .update({
      status: 'failed',
      errorMessage: '取込が完了しないまま中断された可能性があります。再度取り込んでください',
    })
    .eq('organizationId', organizationId)
    .eq('status', 'processing')
    .lt('updatedAt', staleBefore);
  if (error) {
    log.warn({ error }, '滞留インポートの回収に失敗しました');
  }
};

/** 署名付き URL 発行のレート制限（組織単位）。1 回あたり最大 50MB を Storage に置けるため件数で縛る */
export const IDEA_UPLOAD_URL_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 } as const;

const uploadUrlRateLimiter = createFixedWindowRateLimiter(IDEA_UPLOAD_URL_RATE_LIMIT);

/**
 * 署名付き URL の発行枠を 1 つ消費する。上限内なら true。
 * 発行だけ繰り返して Storage を埋める使い方（取込 API を呼ばずに 50MB ずつ積む）を止めるための
 * プロセス内カウンタで、水平スケール時の実効上限は「インスタンス数 × limit」。
 */
export const consumeIdeaUploadUrlQuota = (organizationId: string): boolean =>
  uploadUrlRateLimiter.consume(organizationId);

/** テスト用。レート制限の状態を破棄する */
export const resetIdeaUploadUrlQuota = (): void => uploadUrlRateLimiter.reset();

/** Storage のエラーが「オブジェクトが無い」か（storage-js は HTTP 400 + statusCode '404' で返す） */
const isStorageNotFound = (error: { message?: string; statusCode?: string } | null): boolean =>
  error?.statusCode === '404' || /not found/i.test(error?.message ?? '');

export type IdeaUploadDownloadResult =
  | { ok: true; buffer: Buffer }
  | {
      ok: false;
      /** not_found: 置かれていない / too_large: 上限超過（取得しない）/ error: Storage 側の失敗 */
      reason: 'not_found' | 'too_large' | 'error';
      error?: unknown;
    };

/**
 * quarantine にアップロードされた xlsx を取得する（service_role。バケットにブラウザ向けの
 * select ポリシーは無い）。
 * 取得前に info() でサイズを確認し、上限超過はダウンロードせずに弾く。バケットの file_size_limit は
 * `on conflict do nothing` で作られるため（Dashboard で先に作られていれば別の値もあり得る）、
 * アプリ側の上限は Storage の設定に頼らずここで守る。
 */
export const downloadIdeaUploadFile = async (
  supabase: SupabaseClient,
  storagePath: string,
): Promise<IdeaUploadDownloadResult> => {
  const bucket = supabase.storage.from(IDEA_UPLOAD_BUCKET);
  const { data: info, error: infoError } = await bucket.info(storagePath);
  if (infoError || !info) {
    return isStorageNotFound(infoError)
      ? { ok: false, reason: 'not_found' }
      : { ok: false, reason: 'error', error: infoError };
  }
  if (typeof info.size === 'number' && info.size > IDEA_IMPORT_MAX_FILE_SIZE_BYTES) {
    return { ok: false, reason: 'too_large' };
  }
  const { data, error } = await bucket.download(storagePath);
  if (error || !data) {
    return isStorageNotFound(error)
      ? { ok: false, reason: 'not_found' }
      : { ok: false, reason: 'error', error };
  }
  return { ok: true, buffer: Buffer.from(await data.arrayBuffer()) };
};

/**
 * quarantine のファイルを削除する（取込の完了・失敗・入力不備のいずれでも残置させない）。
 * 失敗しても取込結果には影響させず、ログにだけ残す（ライセンスデータの残置は運用側で検知する）。
 */
export const removeIdeaUploadFile = async (
  supabase: SupabaseClient,
  storagePath: string,
  log: Logger,
): Promise<void> => {
  const { error } = await supabase.storage.from(IDEA_UPLOAD_BUCKET).remove([storagePath]);
  if (error) {
    log.error({ error, storagePath }, 'アップロード一時ファイルの削除に失敗しました');
  }
};

/**
 * quarantine に取り残されたファイルとみなす経過時間。
 * アップロード後にタブを閉じる等で取込 API が呼ばれないとファイルが残るため、署名付き URL の
 * 有効期限（既定 2 時間）より十分長い時間を過ぎたものを、次の URL 発行時に掃除する。
 * 進行中の取込が使うファイル（数分で消える）を巻き込まない長さにしてある。
 */
export const IDEA_UPLOAD_STALE_MS = 24 * 60 * 60 * 1000;

/** 1 ページの一覧件数と、1 回の掃除で読むページ数の上限（最大 1,000 件。通常は 0〜数件） */
const IDEA_UPLOAD_CLEANUP_PAGE_SIZE = 100;
const IDEA_UPLOAD_CLEANUP_MAX_PAGES = 10;

/**
 * 組織の quarantine フォルダから、IDEA_UPLOAD_STALE_MS を過ぎたファイルを削除する。
 * 署名付き URL の発行時に呼ぶ「ついでの掃除」で、スケジューラ無しにホスティングを問わず動かす
 * ためこの形にしている。一覧はページングして全件を見る（名前順で返るため、1 ページ目が新しい
 * ファイルで埋まっていても古いものを取り残さない）。一覧・削除の失敗は URL 発行を止めず、ログにだけ残す。
 * 戻り値は削除したパス（テスト・ログ用）。
 */
export const removeStaleIdeaUploadFiles = async (
  supabase: SupabaseClient,
  organizationId: string,
  log: Logger,
  now: number = Date.now(),
): Promise<string[]> => {
  const folder = `${organizationId}/${IDEA_UPLOAD_FOLDER}`;
  const threshold = now - IDEA_UPLOAD_STALE_MS;
  const stalePaths: string[] = [];
  for (let page = 0; page < IDEA_UPLOAD_CLEANUP_MAX_PAGES; page++) {
    const { data, error } = await supabase.storage.from(IDEA_UPLOAD_BUCKET).list(folder, {
      limit: IDEA_UPLOAD_CLEANUP_PAGE_SIZE,
      offset: page * IDEA_UPLOAD_CLEANUP_PAGE_SIZE,
    });
    if (error) {
      log.warn({ error, folder }, 'アップロード一時ファイルの一覧に失敗しました');
      return [];
    }
    const objects = data ?? [];
    stalePaths.push(
      ...objects
        // id が null の要素はフォルダ。created_at が読めないものは安全側（残す）に倒す
        .filter((object) => object.id !== null && object.created_at !== null)
        .filter((object) => new Date(object.created_at!).getTime() < threshold)
        .map((object) => `${folder}/${object.name}`),
    );
    if (objects.length < IDEA_UPLOAD_CLEANUP_PAGE_SIZE) break;
  }
  if (stalePaths.length === 0) return [];

  const { error: removeError } = await supabase.storage.from(IDEA_UPLOAD_BUCKET).remove(stalePaths);
  if (removeError) {
    log.warn({ error: removeError, stalePaths }, '取り残されたアップロード一時ファイルの削除に失敗しました');
    return [];
  }
  log.info({ count: stalePaths.length }, '取り残されたアップロード一時ファイルを削除しました');
  return stalePaths;
};

/** 配列を size 件ずつに分割する（純関数。チャンク挿入用） */
export const chunkArray = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

/** complete_idea_import RPC の戻り値（JSON） */
export interface IdeaImportCompletionResult {
  rowCount: number;
  /** 新版に同一コードが無く ideaFactorId を外した未算定レコード数（§3.6-2 の警告表示用） */
  unmappedRecordCount: number;
}

export interface ProcessIdeaImportParams {
  importId: string;
  organizationId: string;
  /** アップロードされた xlsx の生バイト列（Route Handler が Storage から取得・検証済み） */
  fileBuffer: Buffer;
  /** 採用する GWP モデルの列識別子（部分一致。IDEA_GWP_MODEL_OPTIONS の value） */
  gwpModel: string;
  /** 呼び出し元から引き継ぐロガー（requestId 等のコンテキスト付き） */
  log?: Logger;
  /** テスト差し替え用。省略時は service_role の管理クライアントを生成する */
  supabase?: SupabaseClient;
}

export interface ProcessIdeaImportResult {
  status: 'completed' | 'failed';
  rowCount: number;
  unmappedRecordCount: number;
  /** GWP 値が空欄のため取込対象外にした行数（§4.1-4。エラーではない） */
  skippedRowCount: number;
  errorMessage: string | null;
}

/**
 * IDEA Excel をパースして idea_factors へ取り込み、完了処理 RPC を呼ぶ。
 * 1行でも不正があれば取込全体を failed とし、部分挿入行を残さない（§4.1）。
 */
export const processIdeaImport = async ({
  importId,
  organizationId,
  fileBuffer,
  gwpModel,
  log: parentLog,
  supabase: injectedClient,
}: ProcessIdeaImportParams): Promise<ProcessIdeaImportResult> => {
  const log = (parentLog ?? baseLogger).child({ ideaImportId: importId });
  const supabase = injectedClient ?? createAdminClient();

  const markFailed = async (errorMessage: string): Promise<ProcessIdeaImportResult> => {
    const { error } = await supabase
      .from('idea_imports')
      .update({ status: 'failed', errorMessage })
      .eq('id', importId);
    if (error) {
      log.error({ error }, '取込失敗ステータスの記録に失敗しました');
    }
    return {
      status: 'failed',
      rowCount: 0,
      unmappedRecordCount: 0,
      skippedRowCount: 0,
      errorMessage,
    };
  };

  // 1. パース（ストリーミング読取 → 純関数パーサー）。壊れた xlsx は読取自体が失敗する。
  let meta: IdeaParsedMeta;
  let rows: IdeaParsedRow[];
  let skippedRowCount: number;
  try {
    const parsed = await readIdeaWorkbookStream(fileBuffer, gwpModel);
    if (parsed.errors.length > 0 || parsed.meta === null) {
      return await markFailed(formatIdeaParseErrors(parsed.errors));
    }
    meta = parsed.meta;
    rows = parsed.rows;
    skippedRowCount = parsed.skippedRows.length;
    if (skippedRowCount > 0) {
      // 画面には件数だけを出すため、どの行が落ちたかは問い合わせ対応用にログへ残す（§4.1-4）。
      // 製品名はライセンスデータなのでログにも出さず、利用者が自分のファイルを引ける
      // 行番号と製品コードだけにする（§0.1）。
      log.info(
        {
          skippedRowCount,
          skippedRows: parsed.skippedRows
            .slice(0, 50)
            .map(({ row, ideaCode }) => ({ row, ideaCode })),
        },
        'GWP値が空欄の行を取込対象外にしました',
      );
    }
  } catch (error) {
    log.error({ error }, 'IDEA Excel の読み込みに失敗しました');
    return await markFailed('Excelファイルの読み込みに失敗しました。IDEAのxlsxファイルか確認してください');
  }

  // 2. パースで確定したメタ情報（バージョン・引用表記・実際の列識別子）を反映する。
  const { error: metaError } = await supabase
    .from('idea_imports')
    .update({
      version: meta.version,
      releaseDate: meta.releaseDate,
      gwpModel: meta.gwpModel,
      citationText: meta.citationText,
      skippedRowCount,
    })
    .eq('id', importId);
  if (metaError) {
    log.error({ error: metaError }, 'インポート記録の更新に失敗しました');
    return await markFailed('インポート記録の更新に失敗しました');
  }

  // 3. 500行チャンクで idea_factors へ挿入（§4.1）。失敗時は部分挿入行を削除する。
  try {
    for (const chunk of chunkArray(rows, IDEA_FACTOR_INSERT_CHUNK_SIZE)) {
      const { error: insertError } = await supabase.from('idea_factors').insert(
        chunk.map((row) => ({
          organizationId,
          importId,
          ideaCode: row.ideaCode,
          productName: row.productName,
          country: row.country,
          dbType: row.dbType,
          baseFlowAmount: row.baseFlowAmount,
          unit: row.unit,
          gwpValue: row.gwpValue,
        })),
      );
      if (insertError) {
        log.error({ error: insertError }, 'idea_factors への挿入に失敗しました');
        throw new Error('係数データの保存に失敗しました');
      }
    }

    // 4. 完了処理（単一トランザクション）: completed/rowCount → 旧 active の false 化 →
    //    新 active 化 → 未算定レコードの ideaCode 再マッピング（§3.6・§4.1-3）。
    const { data, error: completeError } = await supabase.rpc('complete_idea_import', {
      p_import_id: importId,
      p_organization_id: organizationId,
    });
    if (completeError) {
      log.error({ error: completeError }, '取込完了処理（complete_idea_import）に失敗しました');
      throw new Error('取込完了処理に失敗しました');
    }

    const completion = (data ?? {}) as Partial<IdeaImportCompletionResult>;
    return {
      status: 'completed',
      rowCount: completion.rowCount ?? rows.length,
      unmappedRecordCount: completion.unmappedRecordCount ?? 0,
      skippedRowCount,
      errorMessage: null,
    };
  } catch (error) {
    // 失敗時は部分挿入行を削除する（1行でも不正なら残さない。§4.1-3 の受け入れ条件）。
    // 旧 active インポートには触れない（isActive の切替は完了処理内でのみ行われるため、
    // ここに到達した時点では旧版がそのまま active で運用継続できる）。
    const { error: cleanupError } = await supabase
      .from('idea_factors')
      .delete()
      .eq('importId', importId);
    if (cleanupError) {
      log.error({ error: cleanupError }, '部分挿入行の削除に失敗しました');
    }
    const message = error instanceof Error ? error.message : '取込処理に失敗しました';
    return await markFailed(message);
  }
};
