// 活動量の帳票（請求書・検針票・納品書など）で、ブラウザとサーバが共有する型と値。
// ファイル本体は Storage の import-files（{organizationId}/activity-evidence/{id}.{拡張子}）、情報は activity_evidence_files、
// 記録との紐づけは activity_record_evidence に持つ（supabase/migrations/20261026120000_activity_evidence.sql）。

import type { DocumentMimeType } from '@/lib/files/fileSignature';

export type EvidenceMimeType = DocumentMimeType;

/** 保存できる形式（activity_evidence_files_mime_type_check と同じ） */
export const EVIDENCE_MIME_TYPES: readonly EvidenceMimeType[] = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

/** ファイルを選ぶ欄の accept */
export const EVIDENCE_FILE_ACCEPT = EVIDENCE_MIME_TYPES.join(',');

/** 1 ファイルの大きさの上限（activity_evidence_files_size_check と同じ 10MB） */
export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;

/** ファイル名の長さの上限（activity_evidence_files."fileName" の列幅） */
export const EVIDENCE_FILE_NAME_MAX_LENGTH = 255;

/** WebP に変換できる元の形式（PDF は変換しない） */
export type ConvertibleImageType = 'image/png' | 'image/jpeg';

/** 帳票 1 件（画面に出す情報。保存先のパスはダウンロードの URL を作るのに使う） */
export interface EvidenceFile {
  id: string;
  fileName: string;
  mimeType: EvidenceMimeType;
  sizeBytes: number;
  /** WebP に変換して保存したときの元の形式。変換していなければ null */
  convertedFrom: ConvertibleImageType | null;
  storagePath: string;
  createdAt: string;
  uploadedBy: string | null;
}

/** 帳票の一覧の 1 行（紐づいている記録の数つき） */
export interface EvidenceFileListItem extends EvidenceFile {
  linkCount: number;
}

/** 大きさの表示（例: 1.2 MB / 312 KB） */
export const formatEvidenceSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** 形式の表示名 */
export const EVIDENCE_MIME_LABELS: Record<EvidenceMimeType, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};
