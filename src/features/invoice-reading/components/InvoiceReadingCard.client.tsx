'use client';

// データ入力の「請求書から読み取る」カード。電気・都市ガス・燃料の請求書（PDF・画像）を AI で読み取り、
// 使用量と当てはまる排出係数を明細ごとに見せ、「フォームに反映」でデータ入力フォームに入れる。
// 送る前に共通の確認ダイアログ（AiSendConfirmDialog）で送り先と送る内容を見せる。ファイルは保存しない。
// AI が使えない（未設定・モデル未選択）ときは理由を出して、ファイルを選べないようにする。

import React, { useRef } from 'react';
import { FileText, Loader2, ScanText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AiSendConfirmDialog } from '@/features/ai/components/AiSendConfirmDialog.client';
import { useAiStatus } from '@/features/ai/hooks/useAiStatus';
import { AI_GENERATE_ERROR_MESSAGES } from '@/features/ai/messages';
import type { ActivityEntryPrefill } from '@/features/data-input/types';
import { AI_PROVIDER_LABELS, type AiStatus } from '@/types/ai';
import { useInvoiceReading } from '../hooks/useInvoiceReading';
import { INVOICE_FILE_ACCEPT } from '../types';
import { InvoiceReadingItemCard } from './InvoiceReadingItemCard.client';

/** 送信の確認に出す「送る内容」の 2 行目（係数の判定で送るもの） */
export const MATCHING_SEND_ITEM = '読み取った事業者名・料金メニュー・燃料の名称と、排出係数の候補（公表値）';

const formatFileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** AI が使えない理由。使えるなら null */
const unavailableReason = (status: AiStatus | null, statusError: string | null): string | null => {
  if (statusError) return statusError;
  if (!status) return null;
  if (!status.configured) return AI_GENERATE_ERROR_MESSAGES.not_configured;
  if (!status.modelId) return AI_GENERATE_ERROR_MESSAGES.model_not_selected;
  return null;
};

export const InvoiceReadingCard = ({ onApply }: { onApply: (prefill: ActivityEntryPrefill) => void }) => {
  const { status, error: statusError, isLoading: isStatusLoading } = useAiStatus();
  const reading = useInvoiceReading();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reason = unavailableReason(status, statusError);
  const canUse = !isStatusLoading && reason === null;
  const isSending = reading.phase === 'sending';

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ScanText size={20} className="text-primary" />
            <h2 className="text-lg font-serif font-semibold text-text-heading">請求書から読み取る</h2>
          </div>
          <p className="text-xs text-text-muted">
            電気・都市ガス・燃料（ガソリン・軽油・灯油・重油・LPG）の請求書の PDF か画像から、使用量と当てはまる排出係数を AI で読み取り、データ入力フォームに入れます。保存は内容を確かめてから行ってください。
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={INVOICE_FILE_ACCEPT}
          className="hidden"
          aria-label="請求書のファイル"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // 同じファイルを選び直しても onChange が来るよう、値は毎回空に戻す。
            event.target.value = '';
            if (file) reading.selectFile(file);
          }}
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canUse || isSending}
        >
          <FileText />
          ファイルを選ぶ
        </Button>
      </div>

      {reason && <p className="text-sm text-warning">{reason}</p>}
      {canUse && status?.provider && (
        <p className="text-xs text-text-muted">
          送信先: {AI_PROVIDER_LABELS[status.provider]}（{status.modelId}）。PDF・PNG・JPEG・WebP、4MB まで。
        </p>
      )}

      {isSending && (
        <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 size={16} className="animate-spin" />
          「{reading.file?.name}」を読み取っています（30 秒ほどかかることがあります）
        </p>
      )}

      {reading.phase === 'error' && reading.error && (
        <p className="text-sm text-danger" role="alert">
          {reading.error}
        </p>
      )}

      {reading.phase === 'done' && reading.result && (
        <section className="flex flex-col gap-3" aria-label="読み取った内容">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[120px_1fr]">
              <dt className="text-text-muted">ファイル</dt>
              <dd className="break-all text-text-main">{reading.file?.name}</dd>
              <dt className="text-text-muted">事業者</dt>
              <dd className="text-text-main">{reading.result.supplierName ?? '読み取れませんでした'}</dd>
              <dt className="text-text-muted">需要場所</dt>
              <dd className="text-text-main">{reading.result.supplyAddress ?? '読み取れませんでした'}</dd>
              <dt className="text-text-muted">読み取った AI</dt>
              <dd className="text-text-main">
                {AI_PROVIDER_LABELS[reading.result.provider]}（{reading.result.modelId}）
              </dd>
            </dl>
            <Button variant="ghost" size="sm" onClick={reading.reset}>
              <X />
              閉じる
            </Button>
          </div>

          {reading.result.warnings.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-warning">
              {reading.result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {reading.result.items.length === 0 ? (
            <p className="text-sm text-text-muted">使用量の明細を読み取れませんでした。手で入力してください。</p>
          ) : (
            reading.result.items.map((item) => <InvoiceReadingItemCard key={item.index} item={item} onApply={onApply} />)
          )}
        </section>
      )}

      <AiSendConfirmDialog
        isOpen={reading.phase === 'confirming'}
        purposeLabel="請求書の読取り"
        provider={status?.provider ?? null}
        modelId={status?.modelId ?? null}
        items={
          reading.file
            ? [{ name: reading.file.name, note: formatFileSize(reading.file.size) }, { name: MATCHING_SEND_ITEM }]
            : []
        }
        isSending={isSending}
        onCancel={reading.cancel}
        onConfirm={reading.confirm}
      />
    </Card>
  );
};
