'use client';

// 請求書の読取り結果の明細 1 件。読み取った値・係数の判定・拠点の候補・確かめてほしいことを見せ、
// 「フォームに反映」でデータ入力フォームに入れる（保存は人がフォームから行う）。
// AI の出力（理由など）は文字として表示する（HTML として解釈しない）。

import React from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ActivityEntryPrefill } from '@/features/data-input/types';
import type { InvoiceFactorJudgement, InvoiceReadingItem } from '../types';

const JUDGEMENT_BADGES: Record<
  InvoiceFactorJudgement['status'],
  { label: string; variant: 'success' | 'warning' | 'neutral' }
> = {
  matched: { label: '当てはまる係数あり', variant: 'success' },
  provider_only: { label: 'メニューを選んでください', variant: 'warning' },
  not_found: { label: '当てはまる係数なし', variant: 'neutral' },
  unavailable: { label: '判定できませんでした', variant: 'warning' },
};

/** 判定の下に出す、保存したときにどうなるかの説明 */
const judgementNote = (item: InvoiceReadingItem): string | null => {
  const isProvider = item.energyType === 'electricity' || item.energyType === 'city_gas';
  switch (item.factor.status) {
    case 'provider_only':
      return '料金メニューが事業者の公表メニューのどれに当たるか分からないため、フォームでメニューを選んでください。公表メニュー以外の契約は「残差」です。';
    case 'not_found':
      return isProvider
        ? '事業者を選ばずに保存すると、全国の代替値で算定されます。'
        : 'フォームで排出係数の候補から選んでください。';
    default:
      return null;
  }
};

export const InvoiceReadingItemCard = ({
  item,
  onApply,
}: {
  item: InvoiceReadingItem;
  onApply: (prefill: ActivityEntryPrefill) => void;
}) => {
  const badge = JUDGEMENT_BADGES[item.factor.status];
  const note = judgementNote(item);
  const isProvider = item.energyType === 'electricity' || item.energyType === 'city_gas';

  return (
    <article className="flex flex-col gap-3 rounded-md border border-border-light p-4" aria-label={`明細 ${item.index}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-text-heading">{item.title}</h4>
        {item.prefill && (
          <Button size="sm" onClick={() => item.prefill && onApply(item.prefill)}>
            <ArrowDownToLine />
            フォームに反映
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[120px_1fr]">
        <dt className="text-text-muted">使用量</dt>
        <dd className="text-text-main">
          {item.printedAmount ?? '読み取れませんでした'}
          {item.amount && item.printedAmount !== `${item.amount.value.toLocaleString('ja-JP')} ${item.amount.unit}` && (
            <span className="text-text-muted">（フォームには {item.amount.value.toLocaleString('ja-JP')} {item.amount.unit}）</span>
          )}
        </dd>
        <dt className="text-text-muted">{item.energyType?.startsWith('fuel') ? '燃料の名称' : '料金メニュー'}</dt>
        <dd className="text-text-main">{item.planOrFuelName ?? '—'}</dd>
        <dt className="text-text-muted">{isProvider ? '事業者別係数' : '排出係数'}</dt>
        <dd className="flex flex-col gap-1 text-text-main">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={badge.variant} size="sm">
              {badge.label}
            </Badge>
            {'label' in item.factor && <span>{item.factor.label}</span>}
          </span>
          {item.factor.reason && <span className="text-xs text-text-muted">AI の判断: {item.factor.reason}</span>}
          {note && <span className="text-xs text-text-muted">{note}</span>}
        </dd>
        <dt className="text-text-muted">拠点</dt>
        <dd className="text-text-main">{item.location ? `${item.location.name}（住所が一致）` : '—'}</dd>
      </dl>

      {item.notices.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-warning">
          {item.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
    </article>
  );
};
