'use client';

// データ入力の「請求書から読み取る」カード。電気・都市ガス・燃料の請求書（PDF・画像）をまとめて最大 10 個選び、
// 1 つずつ帳票として保存してから AI で読み取る。読み取った明細を表で確かめ、選んだ明細をまとめて登録する
// （登録した記録には読み取った帳票が紐づく）。1 件ずつ直したい明細は「フォームで開く」で統合入力フォームに入れる。
// 送る前に共通の確認ダイアログ（AiSendConfirmDialog）で送り先と送る内容を見せる。登録の前にも件数と排出量を見せる。
// AI が使えない（未設定・モデル未選択）ときは理由を出して、ファイルを選べないようにする。

import React, { useRef, useState } from 'react';
import { FileText, ListChecks, ScanText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/Modal.client';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { AiSendConfirmDialog } from '@/features/ai/components/AiSendConfirmDialog.client';
import { useAiStatus } from '@/features/ai/hooks/useAiStatus';
import { AI_GENERATE_ERROR_MESSAGES } from '@/features/ai/messages';
import { EVIDENCE_FILE_ACCEPT, formatEvidenceSize } from '@/features/activity-evidence/types';
import type { ActivityEntryPrefill, ManualEntryLocationOption, SavedManualActivityRecord } from '@/features/data-input/types';
import type {
  ActivityEntrySaveManyItem,
  ActivityEntrySaveManyResult,
} from '@/features/data-input/hooks/useActivityEntrySave';
import { AI_PROVIDER_LABELS, type AiStatus } from '@/types/ai';
import { useInvoiceBatchReading } from '../hooks/useInvoiceBatchReading';
import { useInvoiceReviewRows } from '../hooks/useInvoiceReviewRows';
import { MAX_INVOICE_FILE_BYTES, MAX_INVOICE_FILES } from '../types';
import { InvoiceBatchProgress } from './InvoiceBatchProgress';
import { InvoiceReviewTable } from './InvoiceReviewTable.client';

/** 送信の確認に出す「送る内容」の最後の行（係数の判定で送るもの） */
export const MATCHING_SEND_ITEM = '読み取った事業者名・料金メニュー・燃料の名称と、排出係数の候補（公表値）';

/** AI が使えない理由。使えるなら null */
const unavailableReason = (status: AiStatus | null, statusError: string | null): string | null => {
  if (statusError) return statusError;
  if (!status) return null;
  if (!status.configured) return AI_GENERATE_ERROR_MESSAGES.not_configured;
  if (!status.modelId) return AI_GENERATE_ERROR_MESSAGES.model_not_selected;
  return null;
};

export const InvoiceReadingCard = ({
  locations,
  historyRecords,
  onApply,
  onSaveRows,
}: {
  locations: readonly ManualEntryLocationOption[];
  historyRecords: readonly SavedManualActivityRecord[];
  onApply: (prefill: ActivityEntryPrefill) => void;
  onSaveRows: (items: ActivityEntrySaveManyItem[]) => Promise<ActivityEntrySaveManyResult>;
}) => {
  const { status, error: statusError, isLoading: isStatusLoading } = useAiStatus();
  const { fiscalYears } = useFiscalYear();
  const batch = useInvoiceBatchReading();
  const review = useInvoiceReviewRows({ results: batch.results, locations, historyRecords, fiscalYears });
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reason = unavailableReason(status, statusError);
  const canUse = !isStatusLoading && reason === null;
  const isRunning = batch.phase === 'running';
  const waiting = batch.entries.filter((entry) => entry.status === 'waiting');
  const totalEmissions = review.selected.reduce((sum, row) => sum + (row.check.emissions ?? 0), 0);
  const filesInSelection = new Map<string, number>();
  for (const row of review.selected) {
    filesInSelection.set(row.source.evidence.fileName, (filesInSelection.get(row.source.evidence.fileName) ?? 0) + 1);
  }

  const save = async () => {
    setIsSaving(true);
    try {
      review.applySaveResult(await onSaveRows(review.entries));
    } finally {
      setIsSaving(false);
      setIsSaveConfirmOpen(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ScanText size={20} className="text-primary" />
            <h2 className="text-lg font-serif font-semibold text-text-heading">請求書から読み取る</h2>
          </div>
          <p className="text-xs text-text-muted">
            電気・都市ガス・燃料（ガソリン・軽油・灯油・重油・LPG）の請求書の PDF か画像を、まとめて {MAX_INVOICE_FILES} 個まで AI で読み取ります。読み取った明細を表で確かめ、選んだ明細をまとめて登録できます。請求書は帳票として保存され、登録した記録に紐づきます。
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={EVIDENCE_FILE_ACCEPT}
            className="hidden"
            aria-label="請求書のファイル"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // 同じファイルを選び直しても onChange が来るよう、値は毎回空に戻す。
              event.target.value = '';
              batch.selectFiles(files);
            }}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!canUse || isRunning || isSaving}>
            <FileText />
            ファイルを選ぶ
          </Button>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={batch.convertToWebp}
              onChange={(event) => batch.setConvertToWebp(event.target.checked)}
              disabled={isRunning}
            />
            画像（PNG・JPEG）を WebP に変換して容量を減らす
          </label>
        </div>
      </div>

      {reason && <p className="text-sm text-warning">{reason}</p>}
      {canUse && status?.provider && (
        <p className="text-xs text-text-muted">
          送信先: {AI_PROVIDER_LABELS[status.provider]}（{status.modelId}）。PDF・PNG・JPEG・WebP。AI で読めるのは 4MB まで（それを超える請求書は帳票として保存だけします）。
        </p>
      )}
      {batch.error && (
        <p className="text-sm text-danger" role="alert">
          {batch.error}
        </p>
      )}

      {batch.phase !== 'idle' && batch.phase !== 'confirming' && batch.entries.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="読み取りの状況">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-heading">読み取りの状況</h3>
            {isRunning ? (
              <Button variant="ghost" size="sm" onClick={batch.stop}>
                ここで止める
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={batch.cancel} disabled={isSaving}>
                <X />
                閉じる
              </Button>
            )}
          </div>
          <InvoiceBatchProgress entries={batch.entries} />
        </section>
      )}

      {review.count > 0 && (
        <section className="flex flex-col gap-3" aria-label="読み取った明細">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-heading">読み取った明細（{review.count} 件）</h3>
            <Button onClick={() => setIsSaveConfirmOpen(true)} disabled={review.entries.length === 0 || isRunning || isSaving}>
              <ListChecks />
              選んだ明細を登録（{review.entries.length} 件）
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            拠点・対象年月・活動量・排出係数は表の中で直せます。確かめることがある明細は、既定ではチェックを入れていません。
          </p>
          <InvoiceReviewTable review={review} locations={locations} onApply={onApply} disabled={isRunning || isSaving} />
        </section>
      )}

      {review.unregistrable.length > 0 && (
        <section className="flex flex-col gap-1" aria-label="登録できない明細">
          <h3 className="text-sm font-semibold text-text-heading">登録できない明細</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-text-muted">
            {review.unregistrable.map(({ evidence, item }) => (
              <li key={`${evidence.id}:${item.index}`}>
                {evidence.fileName}「{item.title}」: {[item.factor.reason, ...item.notices].filter(Boolean).join(' ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      <AiSendConfirmDialog
        isOpen={batch.phase === 'confirming'}
        purposeLabel="請求書の読取り"
        provider={status?.provider ?? null}
        modelId={status?.modelId ?? null}
        items={[
          ...waiting.map((entry) => ({
            name: entry.file.name,
            note:
              entry.file.size > MAX_INVOICE_FILE_BYTES
                ? `${formatEvidenceSize(entry.file.size)}・4MB を超えるため送らず、帳票として保存だけします`
                : formatEvidenceSize(entry.file.size),
          })),
          ...(waiting.some((entry) => entry.file.size <= MAX_INVOICE_FILE_BYTES) ? [{ name: MATCHING_SEND_ITEM }] : []),
        ]}
        isSending={false}
        storageNote="請求書は帳票としてこのアプリに保存し、登録した記録に紐づけます。提供元には保存しない設定で送ります。"
        onCancel={batch.cancel}
        onConfirm={() => void batch.confirm()}
      />

      <Modal isOpen={isSaveConfirmOpen} onClose={() => !isSaving && setIsSaveConfirmOpen(false)} title="選んだ明細を登録します" size="md">
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-text-muted">登録する明細</dt>
            <dd className="text-text-main">{review.entries.length} 件</dd>
            <dt className="text-text-muted">推定排出量の合計</dt>
            <dd className="text-text-main">{Number(totalEmissions.toFixed(3)).toLocaleString('ja-JP')} t-CO2e</dd>
            <dt className="text-text-muted">帳票</dt>
            <dd className="text-text-main">
              <ul className="flex flex-col gap-0.5">
                {[...filesInSelection].map(([fileName, count]) => (
                  <li key={fileName} className="break-all">
                    {fileName}（{count} 件）
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
          <p className="text-xs text-text-muted">登録すると排出量を計算します。読み取った請求書は、登録した記録に帳票として紐づきます。</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsSaveConfirmOpen(false)} disabled={isSaving}>
              やめる
            </Button>
            <Button onClick={() => void save()} disabled={isSaving || review.entries.length === 0}>
              {isSaving ? '登録しています...' : '登録する'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
};
