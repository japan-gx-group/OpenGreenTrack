// 排出係数の判定のバッジと、保存したときにどうなるかの説明（表の「判定」の列で使う）。
// hook・イベントハンドラを持たないため 'use client' は付けない。AI の出力（理由）は文字として表示する。
// アプリが添える説明（note）は、AI の判断と分けて出す。

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { InvoiceFactorJudgement } from '../types';

const JUDGEMENT_BADGES: Record<
  InvoiceFactorJudgement['status'],
  { label: string; variant: 'success' | 'warning' | 'neutral' }
> = {
  matched: { label: '当てはまる係数あり', variant: 'success' },
  provider_only: { label: 'メニューを選んでください', variant: 'warning' },
  not_found: { label: '当てはまる係数なし', variant: 'neutral' },
  unavailable: { label: '判定できませんでした', variant: 'warning' },
};

export const InvoiceJudgementBadge = ({ judgement }: { judgement: InvoiceFactorJudgement }) => {
  const badge = JUDGEMENT_BADGES[judgement.status];
  return (
    <span className="flex flex-col gap-1">
      <Badge variant={badge.variant} size="sm">
        {badge.label}
      </Badge>
      {judgement.status === 'provider_only' && judgement.note && (
        <span className="text-xs text-text-muted">{judgement.note}</span>
      )}
      {judgement.reason && <span className="text-xs text-text-muted">AI の判断: {judgement.reason}</span>}
    </span>
  );
};
