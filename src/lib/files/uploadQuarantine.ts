// upload-quarantine（サーバが中身を確かめる前の一時置き場）の共通の処理（サーバ専用）。IDEA 取込と活動量の帳票で使う。
// ブラウザは service_role が発行した署名付き URL でここへ直接上げ、サーバが中身を確かめてから取り込む・置き直す。
// バケットにはブラウザ向けのポリシーが無い（20260831000003_storage.sql）。
//
// ⚠️ サーバ専用: service_role の管理クライアントを受け取って使うため、Route Handler からのみ import すること。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

export const UPLOAD_QUARANTINE_BUCKET = 'upload-quarantine';

/** Storage のエラーが「オブジェクトが無い」か（storage-js は HTTP 400 + statusCode '404' で返す） */
export const isStorageNotFound = (error: { message?: string; statusCode?: string } | null): boolean =>
  error?.statusCode === '404' || /not found/i.test(error?.message ?? '');

/**
 * 一時置き場に取り残されたファイルとみなす経過時間。
 * アップロード後にタブを閉じる等で取込・保存の API が呼ばれないとファイルが残るため、署名付き URL の
 * 有効期限（既定 2 時間）より十分長い時間を過ぎたものを、次の URL 発行時に掃除する。
 * 進行中の取込・保存が使うファイル（数分で消える）を巻き込まない長さにしてある。
 */
export const UPLOAD_QUARANTINE_STALE_MS = 24 * 60 * 60 * 1000;

/** 1 ページの一覧件数と、1 回の掃除で読むページ数の上限（最大 1,000 件。通常は 0〜数件） */
const CLEANUP_PAGE_SIZE = 100;
const CLEANUP_MAX_PAGES = 10;

/**
 * 一時置き場のフォルダ（`{organizationId}/{用途}`）から、UPLOAD_QUARANTINE_STALE_MS を過ぎたファイルを削除する。
 * 署名付き URL の発行時に呼ぶ「ついでの掃除」で、スケジューラ無しにホスティングを問わず動かす
 * ためこの形にしている。一覧はページングして全件を見る（名前順で返るため、1 ページ目が新しい
 * ファイルで埋まっていても古いものを取り残さない）。一覧・削除の失敗は URL 発行を止めず、ログにだけ残す。
 * 戻り値は削除したパス（テスト・ログ用）。
 */
export const removeStaleQuarantineFiles = async (
  supabase: SupabaseClient,
  folder: string,
  log: Logger,
  now: number = Date.now(),
): Promise<string[]> => {
  const threshold = now - UPLOAD_QUARANTINE_STALE_MS;
  const stalePaths: string[] = [];
  for (let page = 0; page < CLEANUP_MAX_PAGES; page++) {
    const { data, error } = await supabase.storage.from(UPLOAD_QUARANTINE_BUCKET).list(folder, {
      limit: CLEANUP_PAGE_SIZE,
      offset: page * CLEANUP_PAGE_SIZE,
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
    if (objects.length < CLEANUP_PAGE_SIZE) break;
  }
  if (stalePaths.length === 0) return [];

  const { error: removeError } = await supabase.storage.from(UPLOAD_QUARANTINE_BUCKET).remove(stalePaths);
  if (removeError) {
    log.warn({ error: removeError, stalePaths }, '取り残されたアップロード一時ファイルの削除に失敗しました');
    return [];
  }
  log.info({ count: stalePaths.length }, '取り残されたアップロード一時ファイルを削除しました');
  return stalePaths;
};
