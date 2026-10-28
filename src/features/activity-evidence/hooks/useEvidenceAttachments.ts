'use client';

// データ入力フォームの「帳票（請求書など）」の欄の状態。
// - 新規入力: 上げた帳票をこの欄に並べておき、記録を保存したあとに呼び出し側が紐づける（evidenceFileIds）。
//   この欄で上げた帳票を保存前に外したときは、どの記録にも紐づかないまま残らないよう帳票ごと削除する
//   （請求書の読取りなどから最初に入れた帳票は、ほかの記録にも使うことがあるので消さない）
// - 編集: 記録に紐づいている帳票を読み、足す・外すをその場で記録に反映する（記録の保存を待たない）
// 「WebP に変換して容量を減らす」の選択は使う人ごとの好みなので、このブラウザに覚えておく（読めなくても動く）。

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_FILE_BYTES,
  type EvidenceFile,
} from '../types';
import {
  deleteEvidenceFile,
  getRecordEvidence,
  linkEvidence,
  openEvidenceFile,
  unlinkEvidence,
  uploadEvidenceFile,
} from '../services/evidenceClient';
import { convertImageToWebp } from '../services/webpConversion';

const CONVERT_PREFERENCE_KEY = 'ogt.activityEvidence.convertToWebp';

const readConvertPreference = (): boolean => {
  try {
    return window.localStorage.getItem(CONVERT_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
};

const writeConvertPreference = (value: boolean) => {
  try {
    window.localStorage.setItem(CONVERT_PREFERENCE_KEY, String(value));
  } catch {
    // 保存できない環境（プライベートブラウズなど）では、この画面を開いている間だけ覚える。
  }
};

/** 上げる前に分かる理由で断る。送れるなら null */
export const evidenceFileProblem = (file: File): string | null => {
  if (file.size === 0) return 'ファイルが空です';
  if (file.type && !(EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'PDF・PNG・JPEG・WebP のファイルを選んでください';
  }
  if (file.size > MAX_EVIDENCE_FILE_BYTES) return 'ファイルが大きすぎます。10MB 以下にしてください';
  return null;
};

export interface UseEvidenceAttachmentsArgs {
  /** 編集中の記録。指定すると紐づいている帳票を読み、足す・外すをその場で反映する */
  recordId?: string | null;
  /** 新規入力で最初から入れておく帳票（請求書の読取りの「フォームに反映」など） */
  initialFiles?: EvidenceFile[];
  /** 編集で紐づけを変えたあとに、増えた数（外したときは -1）を渡す（入力履歴の帳票の数をその場で直すため） */
  onLinkedCountChange?: (delta: number) => void;
}

export const useEvidenceAttachments = ({ recordId = null, initialFiles, onLinkedCountChange }: UseEvidenceAttachmentsArgs) => {
  const [files, setFiles] = useState<EvidenceFile[]>(initialFiles ?? []);
  // 新規入力のこの欄で上げた帳票（保存前に外したら削除する）。
  const uploadedHereRef = useRef(new Set<string>());
  const [isLoading, setIsLoading] = useState(recordId !== null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [convertToWebp, setConvertToWebpState] = useState(false);

  useEffect(() => {
    // 覚えておいた選択は描画の後に読む（サーバの描画と食い違わないように）。
    setConvertToWebpState(readConvertPreference());
  }, []);

  useEffect(() => {
    if (recordId === null) return;
    let cancelled = false;
    getRecordEvidence(recordId)
      .then((linked) => {
        if (!cancelled) setFiles(linked);
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrors([error instanceof Error ? error.message : '紐づいている帳票を取得できませんでした']);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  const setConvertToWebp = useCallback((value: boolean) => {
    setConvertToWebpState(value);
    writeConvertPreference(value);
  }, []);

  const addFiles = useCallback(
    async (selected: File[]) => {
      setErrors([]);
      for (const original of selected) {
        const problem = evidenceFileProblem(original);
        if (problem) {
          setErrors((current) => [...current, `${original.name}: ${problem}`]);
          continue;
        }
        setUploading((current) => [...current, original.name]);
        try {
          const conversion = convertToWebp ? await convertImageToWebp(original) : null;
          const file = conversion?.file ?? original;
          const uploaded = await uploadEvidenceFile(file, conversion?.converted ? conversion.convertedFrom : null);
          if (recordId !== null) {
            await linkEvidence(recordId, [uploaded.id]);
            onLinkedCountChange?.(1);
          } else {
            uploadedHereRef.current.add(uploaded.id);
          }
          setFiles((current) => [...current, uploaded]);
        } catch (error) {
          setErrors((current) => [
            ...current,
            `${original.name}: ${error instanceof Error ? error.message : '帳票を保存できませんでした'}`,
          ]);
        } finally {
          setUploading((current) => {
            const index = current.indexOf(original.name);
            return index === -1 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
          });
        }
      }
    },
    [convertToWebp, recordId, onLinkedCountChange],
  );

  const remove = useCallback(
    async (fileId: string) => {
      setErrors([]);
      if (recordId !== null) {
        try {
          await unlinkEvidence(recordId, fileId);
          onLinkedCountChange?.(-1);
        } catch (error) {
          setErrors([error instanceof Error ? error.message : '帳票を記録から外せませんでした']);
          return;
        }
      }
      const removed = files.find((file) => file.id === fileId);
      setFiles((current) => current.filter((file) => file.id !== fileId));
      if (recordId === null && uploadedHereRef.current.delete(fileId)) {
        // 欄からは外したまま。消せなかった帳票は「帳票の一覧」に紐づけなしで残るので、そこから消せると伝える。
        try {
          await deleteEvidenceFile(fileId);
        } catch {
          setErrors([`${removed?.fileName ?? '帳票'}: 欄からは外しましたが、保存したファイルを消せませんでした。「帳票の一覧」から削除できます`]);
        }
      }
    },
    [recordId, onLinkedCountChange, files],
  );

  const open = useCallback(async (file: EvidenceFile) => {
    try {
      await openEvidenceFile(file.storagePath);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '帳票を開けませんでした']);
    }
  }, []);

  /** 新規入力で記録を保存したあとに、欄を空にする（並べていた帳票は保存した記録に紐づけたもの） */
  const reset = useCallback(() => {
    uploadedHereRef.current.clear();
    setFiles([]);
    setErrors([]);
  }, []);

  return {
    files,
    isLoading,
    uploading,
    errors,
    convertToWebp,
    setConvertToWebp,
    addFiles,
    remove,
    open,
    reset,
    /** 新規入力の保存で紐づける帳票の ID */
    fileIds: files.map((file) => file.id),
  };
};

export type EvidenceAttachments = ReturnType<typeof useEvidenceAttachments>;
