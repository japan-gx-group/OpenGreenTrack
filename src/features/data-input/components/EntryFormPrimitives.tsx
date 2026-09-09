// 統合データ入力フォームの表示専用プリミティブ。
// セクション見出し・項目ラベル・案内バナー・単位バッジ・参照方式チップの余白と色をここで固定し、
// フォーム本体・係数セクションで同じスケール（ラベル→入力 mb-1.5 / 見出し→本文 gap-3 / バナー px-4 py-3）を使う。
// hook・イベントハンドラを持たないため 'use client' は付けない。

import React from 'react';
import { FACTOR_SOURCE_MODE_LABELS, type FactorSource } from '../services/entryCategory';

interface EntrySectionProps {
  step: number;
  title: string;
  /** 見出し要素の id（section の aria-labelledby に使う） */
  titleId: string;
  /** 見出し右の補足（text-xs muted） */
  hint?: string;
  children: React.ReactNode;
}

/** 番号付きのセクション。見出しと本文の間は gap-3、セクション同士の間隔は親（Card の gap-6）が決める。 */
export const EntrySection = ({ step, title, titleId, hint, children }: EntrySectionProps) => (
  <section aria-labelledby={titleId} className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-contrast"
      >
        {step}
      </span>
      <h3 id={titleId} className="text-sm font-semibold text-text-heading">
        {title}
      </h3>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
    {children}
  </section>
);

interface EntryFieldProps {
  htmlFor: string;
  label: React.ReactNode;
  /** ラベル右の補足（font-normal） */
  hint?: string;
  /** 入力直下の警告（id は `${htmlFor}-error`。aria-describedby に使う） */
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}

/** ラベル + 入力 + 直下の警告。ラベル→入力は mb-1.5、警告は mt-1.5 で統一する。 */
export const EntryField = ({ htmlFor, label, hint, error, className = '', children }: EntryFieldProps) => (
  <div className={className}>
    <label className="mb-1.5 block text-sm font-medium text-text-muted" htmlFor={htmlFor}>
      {label}
      {hint && (
        <>
          {' '}
          <span className="font-normal">{hint}</span>
        </>
      )}
    </label>
    {children}
    {/* 保存/プレビューを押す前でも気づけるよう、入力直下に警告として出す。 */}
    {error && (
      <p id={`${htmlFor}-error`} className="mt-1.5 text-sm text-warning">
        {error}
      </p>
    )}
  </div>
);

interface EntryNoticeProps {
  variant: 'info' | 'warning' | 'danger';
  children: React.ReactNode;
}

const NOTICE_CLASS: Record<EntryNoticeProps['variant'], string> = {
  info: 'border-border-light bg-bg-card text-text-muted',
  warning: 'border-warning bg-warning/10 text-warning',
  danger: 'border-danger bg-danger-light text-danger',
};

/** 案内・警告・エラーのバナー。 */
export const EntryNotice = ({ variant, children }: EntryNoticeProps) => (
  <div className={`rounded-md border px-4 py-3 text-sm ${NOTICE_CLASS[variant]}`}>{children}</div>
);

/** 活動量の単位。表示のみ（入力要素ではない）= 編集不可。未確定時は '—'。id は活動量入力の aria-describedby 先。 */
export const UnitBadge = ({ unit }: { unit: string | null }) => (
  <span
    id="manual-unit-display"
    data-testid="manual-unit-display"
    className="min-w-14 shrink-0 rounded-sm border border-primary bg-primary-light px-3 py-2 text-center text-sm font-semibold text-primary-dark"
  >
    {unit ?? '—'}
  </span>
);

/** 排出係数の参照方式チップ。カテゴリを選んだ時点でフォームが何を判断したかを見せる。 */
export const FactorSourceChip = ({ factorSource }: { factorSource: FactorSource }) => (
  <span
    data-testid="manual-factor-source-chip"
    className="rounded-full border border-primary/30 bg-primary-light px-2.5 py-0.5 text-xs font-semibold text-primary-dark"
  >
    {FACTOR_SOURCE_MODE_LABELS[factorSource]}
  </span>
);
