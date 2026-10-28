// 活動量の帳票のアップロード・削除（サーバ専用）。Route Handler（/api/activity-evidence/*）から呼ぶ。
//
// アップロードは IDEA 取込と同じ形にする。ブラウザは API にファイル本体を送らず、署名付き URL で upload-quarantine へ
// 直接上げ、そのパスを POST /api/activity-evidence に渡す。サーバは置かれたファイルの中身（先頭のバイト・大きさ）を
// 確かめてから import-files（{organizationId}/activity-evidence/{id}.{拡張子}）へ置き直し、帳票の行を作る。
// リクエストボディの上限があるホスティング（Vercel の 4.5MB）でも 10MB の帳票を上げられるようにするため。
//
// - service_role は RLS を越えるため、受け取ったパス・帳票 ID がログイン中の組織のものかを必ずここで確かめる
// - 保存先のパス・拡張子は判定した形式から決める（利用者の入力したファイル名はパスに使わない）
// - 帳票の ID は一時ファイルのパスの UUID にする（同じアップロードの保存が 2 回届いても、帳票は 1 件にする）
// - 確かめた後は、成功・失敗のどの経路でも upload-quarantine のファイルを消す
// - 帳票の削除は、どの記録にも紐づいていないものだけ（紐づけは on delete restrict でも止まる）
// - 上げた・消したことは system_audit_logs に残す（ファイル名・大きさ・SHA-256。中身は残さない）
//
// ⚠️ サーバ専用: service_role の管理クライアントを受け取って使うため、Route Handler からのみ import すること。

import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { DOCUMENT_EXTENSIONS, detectFileMimeType } from '@/lib/files/fileSignature';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';
import {
  UPLOAD_QUARANTINE_BUCKET,
  isStorageNotFound,
  removeStaleQuarantineFiles,
} from '@/lib/files/uploadQuarantine';
import type { CurrentProfile } from '@/lib/currentProfile';
import {
  EVIDENCE_FILE_NAME_MAX_LENGTH,
  MAX_EVIDENCE_FILE_BYTES,
  type ConvertibleImageType,
  type EvidenceFile,
} from '../types';

export const EVIDENCE_BUCKET = 'import-files';
export const EVIDENCE_QUARANTINE_BUCKET = UPLOAD_QUARANTINE_BUCKET;
const EVIDENCE_FOLDER = 'activity-evidence';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const EVIDENCE_SELECT = 'id, fileName, mimeType, sizeBytes, convertedFrom, storagePath, createdAt, uploadedBy';

type Caller = Pick<CurrentProfile, 'id' | 'organizationId'>;

/** 署名付きアップロード URL を発行する upload-quarantine のパス（ファイル名は UUID。利用者の入力は使わない） */
export const buildEvidenceUploadPath = (organizationId: string, uploadId: string = randomUUID()): string =>
  `${organizationId}/${EVIDENCE_FOLDER}/${uploadId}`;

/** 受け取ったパスが、その組織向けに buildEvidenceUploadPath で発行した形か（他組織・任意のパスは false） */
export const isEvidenceUploadPathForOrganization = (storagePath: string, organizationId: string): boolean => {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return false;
  return new RegExp(`^${organizationId}/${EVIDENCE_FOLDER}/${UUID_PATTERN}$`, 'i').test(storagePath);
};

const ALLOWED_EXTENSIONS = /\.(pdf|png|jpe?g|webp)$/i;

/**
 * ファイル名・大きさの事前の確認（ブラウザの申告値。署名付き URL を発行する前に弾く）。
 * 申告値は信じず、POST /api/activity-evidence で置かれたファイルの中身を改めて確かめる。
 */
export const validateEvidenceFileMeta = (
  fileName: string,
  fileSize: number,
): { ok: true } | { ok: false; errorMessage: string } => {
  if (fileName.trim() === '') {
    return { ok: false, errorMessage: 'ファイル名がありません。名前の付いたファイルを選んでください' };
  }
  if (fileName.length > EVIDENCE_FILE_NAME_MAX_LENGTH) {
    return { ok: false, errorMessage: `ファイル名は ${EVIDENCE_FILE_NAME_MAX_LENGTH} 文字以内にしてください` };
  }
  if (!ALLOWED_EXTENSIONS.test(fileName)) {
    return { ok: false, errorMessage: 'PDF・PNG・JPEG・WebP のファイルを選んでください' };
  }
  if (!Number.isInteger(fileSize) || fileSize <= 0) {
    return { ok: false, errorMessage: 'ファイルが空です' };
  }
  if (fileSize > MAX_EVIDENCE_FILE_BYTES) {
    return { ok: false, errorMessage: 'ファイルが大きすぎます。10MB 以下にしてください' };
  }
  return { ok: true };
};

/** 署名付き URL の発行の上限（組織単位）。1 回あたり最大 10MB を置けるため件数で縛る。まとめて 10 件を数回選べる量 */
export const EVIDENCE_UPLOAD_URL_RATE_LIMIT = { limit: 40, windowMs: 10 * 60 * 1000 } as const;

const uploadUrlRateLimiter = createFixedWindowRateLimiter(EVIDENCE_UPLOAD_URL_RATE_LIMIT);

/**
 * 署名付き URL の発行枠を 1 つ使う。上限内なら true。発行だけを繰り返して Storage を埋める使い方を止めるための
 * プロセス内のカウンタで、水平スケールしたときの実効上限は「インスタンス数 × limit」。
 */
export const consumeEvidenceUploadUrlQuota = (organizationId: string): boolean =>
  uploadUrlRateLimiter.consume(organizationId);

/** テスト用。上限の状態を消す */
export const resetEvidenceUploadUrlQuota = (): void => uploadUrlRateLimiter.reset();

/** Storage のエラーが「同じパスに既にある」か（upsert: false で置いたとき） */
const isStorageDuplicate = (error: { message?: string; statusCode?: string } | null): boolean =>
  error?.statusCode === '409' || /already exists/i.test(error?.message ?? '');

/** 署名付き URL を発行する。取り残された古い一時ファイルの掃除は呼び出し側が after() で行う */
export const createEvidenceUploadUrl = async (
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ ok: true; storagePath: string; token: string } | { ok: false; error: unknown }> => {
  const { data, error } = await admin.storage
    .from(EVIDENCE_QUARANTINE_BUCKET)
    .createSignedUploadUrl(buildEvidenceUploadPath(organizationId));
  if (error || !data) return { ok: false, error };
  return { ok: true, storagePath: data.path, token: data.token };
};

/** 組織の一時フォルダから、取り残された古いファイルを消す（URL 発行のついでの掃除。失敗はログだけ） */
export const removeStaleEvidenceUploads = (
  admin: SupabaseClient,
  organizationId: string,
  log: Logger,
  now: number = Date.now(),
): Promise<string[]> => removeStaleQuarantineFiles(admin, `${organizationId}/${EVIDENCE_FOLDER}`, log, now);

export type FinalizeEvidenceResult =
  | { ok: true; file: EvidenceFile }
  | { ok: false; status: 400 | 409 | 500; errorMessage: string };

const INTERNAL_ERROR_MESSAGE = '帳票を保存できませんでした。時間をおいて再度お試しください';
const ALREADY_SAVING_MESSAGE = 'この帳票は保存の途中です。しばらく待ってから「帳票の一覧」を確かめてください';

/** 既に保存した帳票（同じアップロードの保存が 2 回届いたとき、2 回目は 1 回目の帳票を返す） */
const findSavedEvidence = async (admin: SupabaseClient, caller: Caller, id: string): Promise<EvidenceFile | null> => {
  const { data } = await admin
    .from('activity_evidence_files')
    .select(EVIDENCE_SELECT)
    .eq('id', id)
    .eq('organizationId', caller.organizationId)
    .maybeSingle();
  return (data as EvidenceFile | null) ?? null;
};

/**
 * upload-quarantine に置かれたファイルを確かめ、帳票として保存する。どの経路で終わっても一時ファイルは消す。
 * convertedFrom はブラウザで WebP に変換したときの元の形式（申告値。保存した形式が WebP のときだけ記録する）。
 * storagePath は isEvidenceUploadPathForOrganization で確かめたもの（末尾の UUID を帳票の ID にする）。
 * 同じアップロードの保存が続けて・同時に届いても、保存先のパスと行の ID が同じになるので帳票は 1 件にとどまる。
 */
export const finalizeEvidenceUpload = async (args: {
  admin: SupabaseClient;
  caller: Caller;
  storagePath: string;
  fileName: string;
  convertedFrom: ConvertibleImageType | null;
  log: Logger;
}): Promise<FinalizeEvidenceResult> => {
  const { admin, caller, storagePath, log } = args;
  const quarantine = admin.storage.from(EVIDENCE_QUARANTINE_BUCKET);
  try {
    const { data: info, error: infoError } = await quarantine.info(storagePath);
    if (infoError || !info) {
      return isStorageNotFound(infoError)
        ? { ok: false, status: 400, errorMessage: 'アップロードしたファイルが見つかりません。もう一度選んでください' }
        : { ok: false, status: 500, errorMessage: INTERNAL_ERROR_MESSAGE };
    }
    // バケットの file_size_limit は Dashboard で作られていれば別の値もあり得るため、上限はここで守る。
    if (typeof info.size === 'number' && info.size > MAX_EVIDENCE_FILE_BYTES) {
      return { ok: false, status: 400, errorMessage: 'ファイルが大きすぎます。10MB 以下にしてください' };
    }
    const { data: blob, error: downloadError } = await quarantine.download(storagePath);
    if (downloadError || !blob) {
      log.error({ error: downloadError }, '帳票の一時ファイルを読めませんでした');
      return { ok: false, status: 500, errorMessage: INTERNAL_ERROR_MESSAGE };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
      return { ok: false, status: 400, errorMessage: 'ファイルが空か、10MB を超えています' };
    }
    const mimeType = detectFileMimeType(bytes);
    if (!mimeType) {
      return { ok: false, status: 400, errorMessage: 'PDF・PNG・JPEG・WebP のファイルではありません' };
    }

    const id = storagePath.slice(storagePath.lastIndexOf('/') + 1).toLowerCase();
    const finalPath = `${caller.organizationId}/${EVIDENCE_FOLDER}/${id}.${DOCUMENT_EXTENSIONS[mimeType]}`;
    const { error: uploadError } = await admin.storage
      .from(EVIDENCE_BUCKET)
      .upload(finalPath, bytes, { contentType: mimeType, upsert: false });
    if (uploadError) {
      // 同じアップロードの保存が先に置いている。置いたファイルは先の保存のものなので消さない。
      if (isStorageDuplicate(uploadError)) {
        const saved = await findSavedEvidence(admin, caller, id);
        return saved ? { ok: true, file: saved } : { ok: false, status: 409, errorMessage: ALREADY_SAVING_MESSAGE };
      }
      log.error({ error: uploadError }, '帳票を保存先に置けませんでした');
      return { ok: false, status: 500, errorMessage: INTERNAL_ERROR_MESSAGE };
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const row = {
      id,
      organizationId: caller.organizationId,
      storagePath: finalPath,
      fileName: args.fileName.trim().slice(0, EVIDENCE_FILE_NAME_MAX_LENGTH),
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
      convertedFrom: mimeType === 'image/webp' ? args.convertedFrom : null,
      uploadedBy: caller.id,
    };
    const { data: inserted, error: insertError } = await admin
      .from('activity_evidence_files')
      .insert(row)
      .select(EVIDENCE_SELECT)
      .single();
    if (insertError || !inserted) {
      // 行が無いファイルは一覧から消せないため、置いたファイルも消す（行の ID が重なったときも、置いたのはこの保存）。
      await admin.storage.from(EVIDENCE_BUCKET).remove([finalPath]);
      if ((insertError as { code?: string } | null)?.code === '23505') {
        return { ok: false, status: 409, errorMessage: 'この帳票は既に保存されています。もう一度選び直してください' };
      }
      log.error({ error: insertError }, '帳票の行を作れませんでした');
      return { ok: false, status: 500, errorMessage: INTERNAL_ERROR_MESSAGE };
    }

    const { error: auditError } = await admin.from('system_audit_logs').insert({
      organizationId: caller.organizationId,
      userId: caller.id,
      action: 'activity_evidence.upload',
      entityName: 'activity_evidence_files',
      entityId: id,
      detail: JSON.stringify({ fileName: row.fileName, sizeBytes: row.sizeBytes, sha256, mimeType, convertedFrom: row.convertedFrom }),
    });
    if (auditError) log.error({ error: auditError }, '帳票のアップロードの記録に失敗しました');

    return { ok: true, file: inserted as EvidenceFile };
  } finally {
    const { error } = await quarantine.remove([storagePath]);
    if (error) log.error({ error }, '帳票の一時ファイルの削除に失敗しました');
  }
};

export type DeleteEvidenceResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 500; errorMessage: string };

/** 帳票を削除する（どの記録にも紐づいていないものだけ）。Storage のファイルも消す */
export const deleteEvidenceFile = async (args: {
  admin: SupabaseClient;
  caller: Caller;
  id: string;
  log: Logger;
}): Promise<DeleteEvidenceResult> => {
  const { admin, caller, id, log } = args;
  const { data: file, error } = await admin
    .from('activity_evidence_files')
    .select('id, fileName, sizeBytes, sha256, storagePath')
    .eq('id', id)
    .eq('organizationId', caller.organizationId)
    .maybeSingle();
  if (error) {
    log.error({ error }, '帳票の取得に失敗しました');
    return { ok: false, status: 500, errorMessage: '帳票を削除できませんでした' };
  }
  if (!file) return { ok: false, status: 404, errorMessage: '帳票が見つかりません' };

  const { count, error: countError } = await admin
    .from('activity_record_evidence')
    .select('activityRecordId', { count: 'exact', head: true })
    .eq('evidenceFileId', id);
  if (countError) {
    log.error({ error: countError }, '帳票の紐づけの確認に失敗しました');
    return { ok: false, status: 500, errorMessage: '帳票を削除できませんでした' };
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      status: 409,
      errorMessage: `この帳票は ${count} 件の記録に紐づいています。記録から外してから削除してください`,
    };
  }

  // 行を先に消す（行が残っていれば一覧から削除をやり直せる。ファイルだけ残っても一覧には出ない）。
  const { error: deleteError } = await admin.from('activity_evidence_files').delete().eq('id', id);
  if (deleteError) {
    // 削除の直前に紐づけられた（on delete restrict）か、DB の失敗。
    log.warn({ error: deleteError }, '帳票の行を削除できませんでした');
    return { ok: false, status: 409, errorMessage: '帳票を削除できませんでした。記録に紐づいていないか確かめてください' };
  }
  const { error: removeError } = await admin.storage.from(EVIDENCE_BUCKET).remove([file.storagePath as string]);
  if (removeError) log.error({ error: removeError }, '帳票のファイルの削除に失敗しました');

  const { error: auditError } = await admin.from('system_audit_logs').insert({
    organizationId: caller.organizationId,
    userId: caller.id,
    action: 'activity_evidence.delete',
    entityName: 'activity_evidence_files',
    entityId: id,
    detail: JSON.stringify({ fileName: file.fileName, sizeBytes: file.sizeBytes, sha256: file.sha256 }),
  });
  if (auditError) log.error({ error: auditError }, '帳票の削除の記録に失敗しました');
  return { ok: true };
};
