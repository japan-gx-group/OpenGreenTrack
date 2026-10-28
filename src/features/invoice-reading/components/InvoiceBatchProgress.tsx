// まとめて読んでいる請求書の進み具合（ファイルごとの状態）。hook を持たないため 'use client' は付けない。

import React from 'react';
import { CheckCircle2, CircleAlert, Clock, Loader2, Save } from 'lucide-react';
import { formatEvidenceSize } from '@/features/activity-evidence/types';
import type { BatchEntry } from '../hooks/useInvoiceBatchReading';

const statusText = (entry: BatchEntry): string => {
  switch (entry.status) {
    case 'waiting':
      return '順番を待っています';
    case 'saving':
      return '帳票を保存しています';
    case 'reading':
      return 'AI で読み取っています';
    case 'done':
      return `${entry.result?.items.length ?? 0} 件の明細を読み取りました`;
    default:
      return entry.message ?? '';
  }
};

const StatusIcon = ({ status }: { status: BatchEntry['status'] }) => {
  if (status === 'saving' || status === 'reading') return <Loader2 size={16} className="shrink-0 animate-spin text-primary" />;
  if (status === 'waiting' || status === 'waiting_limit') return <Clock size={16} className="shrink-0 text-text-muted" />;
  if (status === 'done') return <CheckCircle2 size={16} className="shrink-0 text-success" />;
  if (status === 'stored_only') return <Save size={16} className="shrink-0 text-text-muted" />;
  return <CircleAlert size={16} className="shrink-0 text-danger" />;
};

export const InvoiceBatchProgress = ({ entries }: { entries: readonly BatchEntry[] }) => (
  <ul className="flex flex-col gap-1.5" aria-label="読み取りの状況" data-testid="invoice-batch-progress">
    {entries.map((entry) => (
      <li key={entry.key} className="flex items-start gap-2 text-sm">
        <StatusIcon status={entry.status} />
        <span className="min-w-0">
          <span className="break-all text-text-main">{entry.file.name}</span>
          <span className="text-xs text-text-muted">（{formatEvidenceSize(entry.file.size)}）</span>
          <span
            className={`block text-xs ${
              entry.status === 'failed' || entry.status === 'rejected' ? 'text-danger' : 'text-text-muted'
            }`}
          >
            {statusText(entry)}
          </span>
        </span>
      </li>
    ))}
  </ul>
);
