// IDEA Excel 取込ジョブの本体処理（docs/idea-scope3-spec.md §4.1）。
// Route Handler（/api/idea-imports）の応答後に非同期で実行され、idea_imports 行へ
// 進捗と結果を書き込む。ブラウザはこの行をポーリングして進捗・結果を取得する
// （受付だけ先に返し、本体はバックグラウンドで進めるパターン）。
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

import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger as baseLogger } from '@/lib/logging/logger';
import type { Logger } from 'pino';
import {
  formatIdeaParseErrors,
  parseIdeaWorkbook,
  type IdeaParsedMeta,
  type IdeaParsedRow,
} from './ideaImport';

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

/** 取込ファイルの上限サイズ。IDEA Excel は数十MBになるため 50MiB（fileValidation.ts と同値） */
export const IDEA_IMPORT_MAX_FILE_SIZE_BYTES = 52_428_800;

/**
 * 取込ファイルの事前検証（純関数）。xlsx（ZIPコンテナ）以外・サイズ超過を弾く。
 * 中身の構造検証はパース時に行うため、ここでは形式だけを確認する。
 */
export const validateIdeaImportFile = (
  fileName: string,
  buffer: Uint8Array,
): { ok: true } | { ok: false; errorMessage: string } => {
  if (buffer.byteLength === 0) {
    return { ok: false, errorMessage: 'ファイルが空です' };
  }
  if (buffer.byteLength > IDEA_IMPORT_MAX_FILE_SIZE_BYTES) {
    return { ok: false, errorMessage: 'ファイルサイズが上限（50MB）を超えています' };
  }
  const ext = fileName.trim().toLowerCase().split('.').pop();
  if (ext !== 'xlsx') {
    return { ok: false, errorMessage: 'xlsx形式のIDEAファイルを選択してください' };
  }
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
  /** アップロードされた xlsx の生バイト列（Route Handler で受信済み） */
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

  // 1. パース（純関数）。壊れた xlsx は load 自体が失敗する。
  let meta: IdeaParsedMeta;
  let rows: IdeaParsedRow[];
  let skippedRowCount: number;
  try {
    const workbook = new ExcelJS.Workbook();
    // exceljs の型定義は独自の Buffer（ArrayBuffer 拡張）を要求するが、実体は Node の
    // Buffer をそのまま受け付けるため型だけ合わせる。
    await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);
    const parsed = parseIdeaWorkbook(workbook, gwpModel);
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
