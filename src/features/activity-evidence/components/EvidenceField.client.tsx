'use client';

// データ入力フォームの「帳票（請求書など）」の欄。上げた帳票を並べ、開く・外すができる。
// 状態は useEvidenceAttachments が持つ（新規は保存のあとに紐づけ、編集はその場で紐づけ・外す）。

import React, { useRef } from 'react';
import { ExternalLink, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EvidenceAttachments } from '../hooks/useEvidenceAttachments';
import { EVIDENCE_FILE_ACCEPT, EVIDENCE_MIME_LABELS, formatEvidenceSize } from '../types';

export const EvidenceField = ({
  attachments,
  isEdit,
  disabled = false,
}: {
  attachments: EvidenceAttachments;
  isEdit: boolean;
  disabled?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = attachments.uploading.length > 0;

  return (
    <div className="flex flex-col gap-3" data-testid="evidence-field">
      <p className="text-xs text-text-muted">
        算定の根拠になる請求書・検針票・納品書などを残せます（PDF・PNG・JPEG・WebP、1 ファイル 10MB まで）。
        {isEdit ? '足す・外すは、すぐにこの記録に反映されます。' : '記録を保存すると、その記録に紐づきます。'}
      </p>

      {attachments.isLoading ? (
        <p className="text-sm text-text-muted">紐づいている帳票を読み込んでいます...</p>
      ) : attachments.files.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {attachments.files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-2 rounded-md border border-border-light px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm text-text-main">
                <FileText size={16} className="shrink-0 text-primary" />
                <span className="truncate" title={file.fileName}>
                  {file.fileName}
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  {EVIDENCE_MIME_LABELS[file.mimeType]}・{formatEvidenceSize(file.sizeBytes)}
                  {file.convertedFrom && `（${EVIDENCE_MIME_LABELS[file.convertedFrom]} から変換）`}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => attachments.open(file)} aria-label={`${file.fileName} を開く`}>
                  <ExternalLink />
                  開く
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => attachments.remove(file.id)}
                  disabled={disabled}
                  aria-label={`${file.fileName} を外す`}
                >
                  <X />
                  外す
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">帳票はまだありません。</p>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 size={16} className="animate-spin" />
          {attachments.uploading.join('、')} を保存しています...
        </p>
      )}
      {attachments.errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-danger" role="alert">
          {attachments.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={EVIDENCE_FILE_ACCEPT}
          className="hidden"
          aria-label="帳票のファイル"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            // 同じファイルを選び直しても onChange が来るよう、値は毎回空に戻す。
            event.target.value = '';
            if (selected.length > 0) void attachments.addFiles(selected);
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
          <Paperclip />
          帳票を追加
        </Button>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={attachments.convertToWebp}
            onChange={(event) => attachments.setConvertToWebp(event.target.checked)}
            disabled={disabled}
          />
          画像（PNG・JPEG）を WebP に変換して容量を減らす
        </label>
      </div>
    </div>
  );
};
