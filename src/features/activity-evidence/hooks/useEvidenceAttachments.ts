'use client';

// データ入力フォームの「帳票（請求書など）」の欄の状態。
// - 新規入力: 上げた帳票をこの欄に並べておき、記録を保存したあとに呼び出し側が紐づける（evidenceFileIds）
// - 編集: 記録に紐づいている帳票を読み、足す・外すをその場で記録に反映する（記録の保存を待たない）
// 「WebP に変換して容量を減らす」の選択は使う人ごとの好みなので、このブラウザに覚えておく（読めなくても動く）。

import { useCallback, useEffect, useState } from 'react';
import {
  EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_FILE_BYTES,
  type EvidenceFile,
} from '../types';
import { getRecordEvidence, linkEvidence, openEvidenceFile, unlinkEvidence, uploadEvidenceFile } from '../services/evidenceClient';
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
  /** 編集で紐づけを変えたあとに呼ぶ（入力履歴の帳票の数を取り直すため） */
  onChanged?: () => void;
}

export const useEvidenceAttachments = ({ recordId = null, initialFiles, onChanged }: UseEvidenceAttachmentsArgs) => {
  const [files, setFiles] = useState<EvidenceFile[]>(initialFiles ?? []);
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
            onChanged?.();
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
    [convertToWebp, recordId, onChanged],
  );

  const remove = useCallback(
    async (fileId: string) => {
      setErrors([]);
      if (recordId !== null) {
        try {
          await unlinkEvidence(recordId, fileId);
          onChanged?.();
        } catch (error) {
          setErrors([error instanceof Error ? error.message : '帳票を記録から外せませんでした']);
          return;
        }
      }
      setFiles((current) => current.filter((file) => file.id !== fileId));
    },
    [recordId, onChanged],
  );

  const open = useCallback(async (file: EvidenceFile) => {
    try {
      await openEvidenceFile(file.storagePath);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '帳票を開けませんでした']);
    }
  }, []);

  /** 新規入力で記録を保存したあとに、欄を空にする */
  const reset = useCallback(() => {
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
