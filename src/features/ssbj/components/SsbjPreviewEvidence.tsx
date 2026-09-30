// プレビュー（T12）の「根拠文書」欄（表示のみ）。保存版の sections.evidence（T10）を描く。
// 開示用参照文だけを常に出し、資料名・版・保管先・参照位置・主管部署は内部記録として
// showInternalNotes のときだけ「開示しない」と明示して出す（docs/ssbj-spec.md §5）。

import type { SsbjEvidence } from '../types';
import { formatFieldValue, isAnswered } from '../utils/fieldValue';
import { formatLinkTarget } from '../utils/riskOpportunity';

const Row = ({ label, value, muted }: { label: string; value: string; muted: boolean }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
    <dt className="w-44 shrink-0 text-xs font-semibold text-text-muted">{label}</dt>
    <dd className={muted ? 'm-0 text-sm text-text-muted' : 'm-0 text-sm whitespace-pre-wrap'}>{value}</dd>
  </div>
);

const INTERNAL_FIELDS: [string, (item: SsbjEvidence) => string | null][] = [
  ['資料名', item => item.documentTitle],
  ['版', item => item.documentVersion],
  ['保管先', item => item.internalLocation],
  ['参照位置', item => item.referencePosition],
  ['主管部署', item => item.ownerDepartment],
];

export const SsbjPreviewEvidence = ({
  items,
  showInternalNotes,
}: {
  items: SsbjEvidence[] | undefined;
  showInternalNotes: boolean;
}) => {
  if (items === undefined) return <p className="m-0 text-sm text-text-muted">この版には含まれていません。</p>;
  if (items.length === 0) return <p className="m-0 text-sm text-text-muted">根拠文書は登録されていません。</p>;

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map(item => (
        <li key={item.id} className="rounded-lg border border-border p-4">
          <p className="m-0 mb-2 text-sm font-bold">{formatLinkTarget(item.itemId)}</p>
          <dl className="m-0 flex flex-col gap-2">
            <Row
              label="開示用参照文"
              value={formatFieldValue(item.disclosure)}
              muted={!isAnswered(item.disclosure)}
            />
            {showInternalNotes && INTERNAL_FIELDS.map(([label, read]) => {
              const value = read(item);
              return (
                <Row
                  key={label}
                  label={`${label}（内部記録・開示しない）`}
                  value={value ?? '未入力'}
                  muted={value === null}
                />
              );
            })}
          </dl>
        </li>
      ))}
    </ul>
  );
};
