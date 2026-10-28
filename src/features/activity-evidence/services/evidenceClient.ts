// 活動量の帳票の読み書き（ブラウザから呼ぶ I/O）。
// - アップロード: 署名付き URL の発行（POST /api/activity-evidence/upload-url）→ upload-quarantine へ直接上げる
//   → 保存（POST /api/activity-evidence。サーバが中身を確かめて帳票の行を作る）
// - 一覧・紐づけ・外す: Supabase クライアントから直接（RLS で自組織に限る。紐づけは記録と帳票の両方が自組織のときだけ）
// - 開く: import-files の署名付き URL（Storage の import_files_select_own_organization で自組織のフォルダに限る）
// - 削除: DELETE /api/activity-evidence/[id]（どの記録にも紐づいていないものだけ。Storage のファイルも消す）

import { createClient } from '@/lib/supabase/client';
import { IN_CHUNK_SIZE, chunk, fetchAllRows } from '@/lib/supabaseRows';
import {
  type ConvertibleImageType,
  type EvidenceFile,
  type EvidenceFileListItem,
} from '../types';

const EVIDENCE_BUCKET = 'import-files';
const EVIDENCE_SELECT = 'id, fileName, mimeType, sizeBytes, convertedFrom, storagePath, createdAt, uploadedBy';
/** 開く URL の有効期間（秒）。開いたタブで読み終えるまでの長さ */
const OPEN_URL_EXPIRES_IN = 300;

const errorMessageOf = async (response: Response, fallback: string): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback;
};

const postJson = async (url: string, body: unknown, fallback: string): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('通信に失敗しました。時間をおいて再度お試しください');
  }
  if (!response.ok) throw new Error(await errorMessageOf(response, fallback));
  return response.json();
};

/**
 * 帳票を 1 つ上げて保存する。WebP への変換は呼び出し側が済ませ、変換したときは元の形式を convertedFrom で渡す。
 * 失敗したら、画面にそのまま出せる文の Error を投げる。
 */
export const uploadEvidenceFile = async (
  file: File,
  convertedFrom: ConvertibleImageType | null = null,
): Promise<EvidenceFile> => {
  const issued = (await postJson(
    '/api/activity-evidence/upload-url',
    { fileName: file.name, fileSize: file.size },
    '帳票のアップロードを始められませんでした',
  )) as { bucket: string; storagePath: string; token: string };

  const { error } = await createClient()
    .storage.from(issued.bucket)
    .uploadToSignedUrl(issued.storagePath, issued.token, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error('帳票をアップロードできませんでした。時間をおいて再度お試しください');

  return (await postJson(
    '/api/activity-evidence',
    { storagePath: issued.storagePath, fileName: file.name, convertedFrom },
    '帳票を保存できませんでした',
  )) as EvidenceFile;
};

type EvidenceListRow = EvidenceFile & { activity_record_evidence?: Array<{ count: number }> | null };

/** 組織の帳票の一覧（新しい順。紐づいている記録の数つき） */
export const listEvidenceFiles = async (): Promise<EvidenceFileListItem[]> => {
  const supabase = createClient();
  const rows = await fetchAllRows<EvidenceListRow>(
    (from, to) =>
      supabase
        .from('activity_evidence_files')
        .select(`${EVIDENCE_SELECT}, activity_record_evidence(count)`)
        .order('createdAt', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    '帳票の一覧を取得できませんでした',
  );
  return rows.map(({ activity_record_evidence: links, ...file }) => ({
    ...file,
    sizeBytes: Number(file.sizeBytes),
    linkCount: Number(links?.[0]?.count ?? 0),
  }));
};

type RecordEvidenceRow = { activity_evidence_files: EvidenceFile | EvidenceFile[] | null };

/** 記録に紐づいている帳票（紐づけた順） */
export const getRecordEvidence = async (activityRecordId: string): Promise<EvidenceFile[]> => {
  const { data, error } = await createClient()
    .from('activity_record_evidence')
    .select(`activity_evidence_files(${EVIDENCE_SELECT})`)
    .eq('activityRecordId', activityRecordId)
    .order('createdAt', { ascending: true });
  if (error) throw new Error('紐づいている帳票を取得できませんでした');
  return ((data ?? []) as RecordEvidenceRow[]).flatMap((row) => {
    const file = Array.isArray(row.activity_evidence_files) ? row.activity_evidence_files[0] : row.activity_evidence_files;
    return file ? [{ ...file, sizeBytes: Number(file.sizeBytes) }] : [];
  });
};

/** 帳票を記録に紐づける（既に紐づいているものは飛ばす）。組織は記録から引く（RLS が記録・帳票の組織を確かめる） */
export const linkEvidence = async (activityRecordId: string, evidenceFileIds: string[]): Promise<void> => {
  if (evidenceFileIds.length === 0) return;
  const supabase = createClient();
  const { data: record, error: recordError } = await supabase
    .from('activity_records')
    .select('organizationId')
    .eq('id', activityRecordId)
    .single();
  if (recordError || !record) throw new Error('帳票を紐づける記録が見つかりません');
  const { error } = await supabase.from('activity_record_evidence').upsert(
    evidenceFileIds.map((evidenceFileId) => ({
      activityRecordId,
      evidenceFileId,
      organizationId: (record as { organizationId: string }).organizationId,
    })),
    { onConflict: 'activityRecordId,evidenceFileId', ignoreDuplicates: true },
  );
  if (error) throw new Error('帳票を記録に紐づけられませんでした');
};

/** 帳票を記録から外す（帳票のファイルは残る） */
export const unlinkEvidence = async (activityRecordId: string, evidenceFileId: string): Promise<void> => {
  const { error } = await createClient()
    .from('activity_record_evidence')
    .delete()
    .eq('activityRecordId', activityRecordId)
    .eq('evidenceFileId', evidenceFileId);
  if (error) throw new Error('帳票を記録から外せませんでした');
};

/** 帳票を開く URL（短い期間だけ有効な署名付き URL） */
export const createEvidenceOpenUrl = async (storagePath: string): Promise<string> => {
  const { data, error } = await createClient().storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, OPEN_URL_EXPIRES_IN);
  if (error || !data) throw new Error('帳票を開けませんでした');
  return data.signedUrl;
};

/**
 * 帳票を新しいタブで開く。ポップアップとして止められないよう、クリックの直後に空のタブを開いてから URL を入れる
 * （noopener を付けると戻り値が null になり URL を入れられないため、開いたあとで opener を切る）。
 */
export const openEvidenceFile = async (storagePath: string): Promise<void> => {
  const opened = window.open('', '_blank');
  if (opened) opened.opener = null;
  try {
    const url = await createEvidenceOpenUrl(storagePath);
    if (opened) opened.location.href = url;
    else window.open(url, '_blank', 'noopener');
  } catch (error) {
    opened?.close();
    throw error;
  }
};

/**
 * 上げた人の名前（自組織のメンバー。見つからなければ含めない）。読めなければ Error を投げる。
 * 人数が多いと .in() の URL が長くなりすぎる（414）ため、ID を分けて引く。
 */
export const getUploaderNames = async (userIds: string[]): Promise<Map<string, string>> => {
  const ids = [...new Set(userIds)];
  const supabase = createClient();
  const names = new Map<string, string>();
  for (const part of chunk(ids, IN_CHUNK_SIZE)) {
    const { data, error } = await supabase.from('profiles').select('id, fullName').in('id', part);
    if (error) throw new Error('上げた人の名前を読み込めませんでした');
    for (const row of (data ?? []) as Array<{ id: string; fullName: string | null }>) names.set(row.id, row.fullName ?? '');
  }
  return names;
};

/** 帳票を削除する（どの記録にも紐づいていないものだけ。紐づいていれば理由の文で Error を投げる） */
export const deleteEvidenceFile = async (id: string): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`/api/activity-evidence/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    throw new Error('通信に失敗しました。時間をおいて再度お試しください');
  }
  if (!response.ok) throw new Error(await errorMessageOf(response, '帳票を削除できませんでした'));
};
