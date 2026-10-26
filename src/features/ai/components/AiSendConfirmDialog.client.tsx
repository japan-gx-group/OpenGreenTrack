'use client';

// AI に送る前の確認ダイアログ（AI を使う各機能が共通で使う部品）。
// 送り先（提供元・モデル）と送る内容を見せ、「送信する」を押したときだけ送る（共通のルール: 送る前に見せる）。
// 送信先・モデルは GET /api/ai/status（useAiStatus）の値を渡す。送った内容の扱い（保存しない・候補として見せる）も添える。

import React from 'react';
import { Loader2, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal.client';
import { AI_PROVIDER_LABELS, type AiProviderId } from '@/types/ai';

// 使ってよい鍵の条件と、提供元のデータの扱い（セットアップガイドの「2-I. AI の設定（任意）」）。
const AI_DATA_HANDLING_DOC_URL =
  'https://github.com/japan-gx-group/OpenGreenTrack/blob/main/docs/setup-guide.md#2-i-ai-の設定任意';

export interface AiSendItem {
  /** 表示名（ファイル名など） */
  name: string;
  /** 補足（大きさ・ページ数など） */
  note?: string;
}

export const AiSendConfirmDialog = ({
  isOpen,
  purposeLabel,
  provider,
  modelId,
  items,
  isSending,
  onCancel,
  onConfirm,
  storageNote = '送った内容は、このアプリにも提供元にも保存しない設定で送ります。',
}: {
  isOpen: boolean;
  /** 用途の表示名（例: 請求書の読取り） */
  purposeLabel: string;
  provider: AiProviderId | null;
  modelId: string | null;
  items: AiSendItem[];
  isSending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** 送った内容をどこに残すか（既定は「アプリにも提供元にも保存しない」）。帳票として残す用途は、その旨を渡す */
  storageNote?: string;
}) => (
  <Modal
    isOpen={isOpen}
    onClose={() => {
      if (!isSending) onCancel();
    }}
    title="AI に送信します"
  >
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-main">「{purposeLabel}」のため、次の内容を AI に送ります。</p>
      <dl className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-text-muted">送信先</dt>
        <dd className="text-text-main">
          {provider ? AI_PROVIDER_LABELS[provider] : '未設定'}
          {modelId && <span className="text-text-muted">（{modelId}）</span>}
        </dd>
        <dt className="text-text-muted">送る内容</dt>
        <dd className="text-text-main">
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.name} className="break-all">
                {item.name}
                {item.note && <span className="text-text-muted">（{item.note}）</span>}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      <p className="text-xs text-text-muted">
        {storageNote}AI の結果は候補として表示し、保存は確認してから行ってください。提供元の扱いは{' '}
        <a
          href={AI_DATA_HANDLING_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          セットアップガイド「2-I. AI の設定」
        </a>
        を参照してください。
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="gt-btn" onClick={onCancel} disabled={isSending}>
          やめる
        </button>
        <button
          type="button"
          className="gt-btn-primary flex items-center gap-2"
          onClick={onConfirm}
          disabled={isSending || !provider || !modelId || items.length === 0}
        >
          {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          送信する
        </button>
      </div>
    </div>
  </Modal>
);
