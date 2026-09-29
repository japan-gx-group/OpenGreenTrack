// プレビュー（T12）の「戦略」欄のうち、リスク・機会と時間軸の定義（表示のみ）。
// 未入力・未確認・非該当は状態のラベルで出し、空欄や「なし」にしない。内部メモは showInternalNotes のときだけ、
// 開示する文章と別の行に「開示しない」と明示して出す（docs/ssbj-spec.md §5）。

import {
  SSBJ_RISK_OPPORTUNITY_KIND_LABELS,
  SSBJ_RISK_TYPE_LABELS,
  SSBJ_TIME_HORIZON_LABELS,
  type SsbjRiskOpportunity,
  type SsbjTimeHorizonDefinitions,
} from '../types';
import { formatFieldValue, isAnswered } from '../utils/fieldValue';
import { formatLinkTarget } from '../utils/riskOpportunity';

const Row = ({ label, value, muted }: { label: string; value: string; muted: boolean }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
    <dt className="w-44 shrink-0 text-xs font-semibold text-text-muted">{label}</dt>
    <dd className={muted ? 'm-0 text-sm text-text-muted' : 'm-0 text-sm whitespace-pre-wrap'}>{value}</dd>
  </div>
);

const NOT_INCLUDED = 'この版には含まれていません。';

export const SsbjPreviewRisks = ({
  items,
  showInternalNotes,
}: {
  items: SsbjRiskOpportunity[] | undefined;
  showInternalNotes: boolean;
}) => {
  if (items === undefined) return <p className="m-0 text-sm text-text-muted">{NOT_INCLUDED}</p>;
  if (items.length === 0) return <p className="m-0 text-sm text-text-muted">リスク・機会は登録されていません。</p>;

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map(item => (
        <li key={item.id} className="rounded-lg border border-border p-4">
          <p className="m-0 mb-2 text-sm font-bold">
            {SSBJ_RISK_OPPORTUNITY_KIND_LABELS[item.kind]}：{item.title}
          </p>
          <dl className="m-0 flex flex-col gap-2">
            {item.kind === 'risk' && (
              <Row
                label="リスクの種類"
                value={formatFieldValue(item.riskType, value => SSBJ_RISK_TYPE_LABELS[value])}
                muted={!isAnswered(item.riskType)}
              />
            )}
            <Row
              label="時間軸"
              value={formatFieldValue(item.timeHorizon, value => SSBJ_TIME_HORIZON_LABELS[value])}
              muted={!isAnswered(item.timeHorizon)}
            />
            <Row
              label="説明"
              value={formatFieldValue(item.description.disclosure)}
              muted={!isAnswered(item.description.disclosure)}
            />
            {showInternalNotes && (
              <Row
                label="内部メモ（開示しない）"
                value={item.description.internalNote ?? '未入力'}
                muted={item.description.internalNote === null}
              />
            )}
            <Row
              label="関連する章・項目"
              value={item.linkTargets.length === 0 ? '関連付けなし' : item.linkTargets.map(formatLinkTarget).join('、')}
              muted={item.linkTargets.length === 0}
            />
          </dl>
        </li>
      ))}
    </ul>
  );
};

export const SsbjPreviewTimeHorizons = ({
  definitions,
  showInternalNotes,
}: {
  definitions: SsbjTimeHorizonDefinitions | undefined;
  showInternalNotes: boolean;
}) => {
  if (definitions === undefined) return <p className="m-0 text-sm text-text-muted">{NOT_INCLUDED}</p>;
  const rows: [string, SsbjTimeHorizonDefinitions['shortTerm']][] = [
    ['「短期」の定義', definitions.shortTerm],
    ['「中期」の定義', definitions.mediumTerm],
    ['「長期」の定義', definitions.longTerm],
    ['戦略上の計画期間との関係', definitions.planningHorizonRelation],
  ];
  return (
    <dl className="m-0 flex flex-col gap-2">
      {rows.map(([label, value]) => (
        <Row key={label} label={label} value={formatFieldValue(value)} muted={!isAnswered(value)} />
      ))}
      {showInternalNotes && (
        <Row
          label="内部メモ（開示しない）"
          value={definitions.internalNote ?? '未入力'}
          muted={definitions.internalNote === null}
        />
      )}
    </dl>
  );
};
