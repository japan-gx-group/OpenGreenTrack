// リスク・機会の一覧（表示のみ）。説明・時間軸の未入力 / 未確認 / 非該当は状態のラベルで出し、
// 空欄や「なし」にしない。内部メモは開示する説明と別の行に「開示しない」と明示して出す（docs/ssbj-spec.md §5）。

import { Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  SSBJ_RISK_OPPORTUNITY_KIND_LABELS,
  SSBJ_TIME_HORIZON_LABELS,
  type SsbjRiskOpportunity,
} from '../types';
import { formatFieldValue, isAnswered } from '../utils/fieldValue';
import { formatLinkTarget } from '../utils/riskOpportunity';

const Row = ({ label, value, muted }: { label: string; value: string; muted: boolean }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
    <dt className="w-40 shrink-0 text-xs font-semibold text-text-muted">{label}</dt>
    <dd className={muted ? 'm-0 text-sm text-text-muted' : 'm-0 text-sm whitespace-pre-wrap'}>{value}</dd>
  </div>
);

interface SsbjRiskOpportunityListProps {
  items: SsbjRiskOpportunity[];
  onEdit: (item: SsbjRiskOpportunity) => void;
  onDelete: (item: SsbjRiskOpportunity) => void;
}

export const SsbjRiskOpportunityList = ({ items, onEdit, onDelete }: SsbjRiskOpportunityListProps) => {
  if (items.length === 0) {
    return <p className="m-0 py-6 text-center text-sm text-text-muted">リスク・機会はまだ登録されていません。</p>;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map(item => (
        <li key={item.id} className="rounded-lg border border-border p-4" data-testid="ssbj-risk-opportunity">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={item.kind === 'risk' ? 'warning' : 'success'}>
                {SSBJ_RISK_OPPORTUNITY_KIND_LABELS[item.kind]}
              </Badge>
              <h3 className="m-0 text-sm font-bold break-words">{item.title}</h3>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onEdit(item)}>
                <Pencil size={14} />
                編集
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onDelete(item)}>
                <Trash2 size={14} />
                削除
              </Button>
            </div>
          </div>
          <dl className="m-0 flex flex-col gap-2">
            <Row
              label="時間軸"
              value={formatFieldValue(item.timeHorizon, value => SSBJ_TIME_HORIZON_LABELS[value])}
              muted={!isAnswered(item.timeHorizon)}
            />
            <Row
              label="説明（開示）"
              value={formatFieldValue(item.description.disclosure)}
              muted={!isAnswered(item.description.disclosure)}
            />
            <Row
              label="内部メモ（開示しない）"
              value={item.description.internalNote ?? '未入力'}
              muted={item.description.internalNote === null}
            />
            <Row
              label="関連する章・項目"
              value={
                item.linkTargets.length === 0 ? '関連付けなし' : item.linkTargets.map(formatLinkTarget).join('、')
              }
              muted={item.linkTargets.length === 0}
            />
          </dl>
        </li>
      ))}
    </ul>
  );
};
