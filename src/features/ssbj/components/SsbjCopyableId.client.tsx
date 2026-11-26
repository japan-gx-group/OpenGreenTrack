'use client';

// 項目 ID・版 ID など、業務の利用者には読む必要が無いが、問い合わせや確認で使う ID を、小さく薄く出してコピーできるようにする。
// 名前と同じ強さで出すと画面の主（名前・内容）が埋もれるため、控えめに出す。コピーできない環境では、文字を選んでコピーしてもらう。

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface SsbjCopyableIdProps {
  value: string;
  /** 読み上げとコピーのボタンに使う名前（例: 「項目 ID」）。 */
  label: string;
  /** 画面に出す文字（省略時は value）。長い ID を縮めて出すときに使う。 */
  display?: string;
}

export const SsbjCopyableId = ({ value, label, display }: SsbjCopyableIdProps) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードに書けない環境では何もしない（文字は選んでコピーできる）。
    }
  };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-subtle">
      <span className="select-all font-mono" title={`${label}: ${value}`}>{display ?? value}</span>
      <button
        type="button"
        aria-label={copied ? `${label} をコピーしました` : `${label} をコピー`}
        title={copied ? 'コピーしました' : `${label} をコピー`}
        className="inline-flex size-5 items-center justify-center rounded hover:bg-muted hover:text-text-muted"
        onClick={() => void copy()}
      >
        {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      </button>
    </span>
  );
};
