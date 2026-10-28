'use client';

// 請求書をまとめて読む流れ（ファイルを選ぶ → 送信の確認 → 1 つずつ「帳票として保存 → AI で読む」）。
// - 選んだだけでは送らない（共通の確認ダイアログで送り先と送る内容を見せてから confirm で始める）
// - 帳票として先に保存する（AI で読めなくても、記録の根拠として残すため）。4MB を超える帳票は保存だけする
// - 回数の上限（429）に当たったら、Retry-After の秒数だけ待って同じファイルを読み直す（最大 3 回）
// - 「ここで止める」で、読み取り中のファイルが終わったところで止める

import { useCallback, useMemo, useRef, useState } from 'react';
import { evidenceFileProblem } from '@/features/activity-evidence/hooks/useEvidenceAttachments';
import { uploadEvidenceFile } from '@/features/activity-evidence/services/evidenceClient';
import { convertImageToWebp } from '@/features/activity-evidence/services/webpConversion';
import { useConvertPreference } from '@/features/activity-evidence/hooks/useConvertPreference';
import type { EvidenceFile } from '@/features/activity-evidence/types';
import { requestInvoiceReading } from '../services/invoiceReadingClient';
import { MAX_INVOICE_FILE_BYTES, MAX_INVOICE_FILES, type InvoiceReadingResult } from '../types';

export type BatchEntryStatus =
  /** 送る前に断った（形式・大きさ） */
  | 'rejected'
  | 'waiting'
  | 'saving'
  | 'reading'
  /** 回数の上限のため待っている */
  | 'waiting_limit'
  | 'done'
  /** 4MB を超えるため、帳票として保存だけした */
  | 'stored_only'
  | 'failed'
  /** 「ここで止める」で読まなかった */
  | 'skipped';

export interface BatchEntry {
  key: string;
  file: File;
  status: BatchEntryStatus;
  message: string | null;
  evidence: EvidenceFile | null;
  result: InvoiceReadingResult | null;
}

export type BatchPhase = 'idle' | 'confirming' | 'running' | 'finished';

/** 回数の上限に当たったときに読み直す回数 */
export const MAX_LIMIT_RETRIES = 3;
/** Retry-After が無いときに待つ秒数 */
const DEFAULT_RETRY_SECONDS = 60;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const useInvoiceBatchReading = () => {
  const [phase, setPhase] = useState<BatchPhase>('idle');
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 「WebP に変換して容量を減らす」は、同じ画面の帳票の欄と同じ選択（このブラウザに覚える）
  const { convertToWebp, setConvertToWebp } = useConvertPreference();
  const stopRequestedRef = useRef(false);
  const runIdRef = useRef(0);

  const update = (key: string, patch: Partial<BatchEntry>) =>
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));

  const selectFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    if (files.length > MAX_INVOICE_FILES) {
      setError(`一度に選べるのは ${MAX_INVOICE_FILES} ファイルまでです（${files.length} ファイルが選ばれました）`);
      return;
    }
    setError(null);
    const selected = files.map((file, index): BatchEntry => {
      const problem = evidenceFileProblem(file);
      return {
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        status: problem ? 'rejected' : 'waiting',
        message: problem,
        evidence: null,
        result: null,
      };
    });
    setEntries(selected);
    setPhase(selected.some((entry) => entry.status === 'waiting') ? 'confirming' : 'finished');
  }, []);

  const cancel = useCallback(() => {
    runIdRef.current += 1;
    setEntries([]);
    setPhase('idle');
  }, []);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
  }, []);

  const confirm = useCallback(async () => {
    const runId = (runIdRef.current += 1);
    stopRequestedRef.current = false;
    setPhase('running');
    const targets = entries.filter((entry) => entry.status === 'waiting');
    for (const entry of targets) {
      if (runIdRef.current !== runId) return;
      if (stopRequestedRef.current) {
        update(entry.key, { status: 'skipped', message: '読み取りを止めたため、読んでいません' });
        continue;
      }

      update(entry.key, { status: 'saving', message: null });
      let evidence: EvidenceFile;
      try {
        const conversion = convertToWebp ? await convertImageToWebp(entry.file) : null;
        evidence = await uploadEvidenceFile(conversion?.file ?? entry.file, conversion?.converted ? conversion.convertedFrom : null);
      } catch (uploadError) {
        update(entry.key, {
          status: 'failed',
          message: uploadError instanceof Error ? uploadError.message : '帳票を保存できませんでした',
        });
        continue;
      }
      if (evidence.sizeBytes > MAX_INVOICE_FILE_BYTES) {
        update(entry.key, {
          status: 'stored_only',
          evidence,
          message: '4MB を超えるため AI では読めません。帳票は保存したので、手で入力して紐づけてください',
        });
        continue;
      }

      update(entry.key, { status: 'reading', evidence });
      for (let attempt = 0; ; attempt += 1) {
        const outcome = await requestInvoiceReading(evidence.id);
        if (runIdRef.current !== runId) return;
        if (outcome.ok) {
          update(entry.key, { status: 'done', result: outcome.result, message: null });
          break;
        }
        if (outcome.status === 429 && attempt < MAX_LIMIT_RETRIES) {
          const seconds = outcome.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS;
          update(entry.key, { status: 'waiting_limit', message: `AI の利用回数の上限のため、${seconds} 秒待ってから読み直します` });
          await wait(seconds * 1000);
          if (runIdRef.current !== runId) return;
          update(entry.key, { status: 'reading', message: null });
          continue;
        }
        update(entry.key, { status: 'failed', message: outcome.message });
        break;
      }
    }
    if (runIdRef.current === runId) setPhase('finished');
  }, [entries, convertToWebp]);

  // 表の行はこの配列から作るため、読み終えたファイルが増えたときだけ作り直す。
  const results = useMemo(
    () => entries.flatMap((entry) => (entry.status === 'done' && entry.result ? [entry.result] : [])),
    [entries],
  );

  return {
    phase,
    entries,
    error,
    convertToWebp,
    setConvertToWebp,
    selectFiles,
    confirm,
    cancel,
    stop,
    /** 読み取りの結果（読み終えたファイルの順） */
    results,
  };
};

export type InvoiceBatchReading = ReturnType<typeof useInvoiceBatchReading>;
