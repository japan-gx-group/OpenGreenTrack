// プレビュー（T12）の章ごとの文章（T05。sections.narratives。表示のみ）。
// 要求項目マスターの項目の順に並べ、文章の無い項目は「未入力」と出す（空欄にしない）。項目には答える要求の項番号を添える。
// 内部メモは showInternalNotes のときだけ「開示しない」と明示して出す（docs/ssbj-spec.md §5）。

import type { SsbjNarrative, SsbjSectionId } from '../types';
import { formatFieldValue, isAnswered } from '../utils/fieldValue';
import { ssbjNarrativeEntriesOfSection } from '../utils/narrative';
import { formatParagraphReference, ssbjRequirementsOfItem } from '../utils/requirementMaster';

export const SsbjPreviewNarratives = ({
  sectionId,
  narratives,
  showInternalNotes,
}: {
  sectionId: SsbjSectionId;
  narratives: SsbjNarrative[] | undefined;
  showInternalNotes: boolean;
}) => {
  if (narratives === undefined) {
    return <p className="m-0 text-sm text-text-muted">この版には四本柱の文章が含まれていません。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {ssbjNarrativeEntriesOfSection(sectionId, narratives).map(entry => {
        const references = ssbjRequirementsOfItem(entry.itemId)
          .flatMap(requirement => requirement.references.slice(0, 1).map(formatParagraphReference));
        return (
          <div key={entry.itemId} className="flex flex-col gap-1">
            <h4 className="m-0 text-sm font-bold">
              {entry.item?.label ?? entry.itemId}
              {references.length > 0 && <span className="ml-2 text-xs font-normal text-text-muted">（{references.join('・')}）</span>}
            </h4>
            <p className={isAnswered(entry.text.disclosure) ? 'm-0 text-sm whitespace-pre-wrap' : 'm-0 text-sm text-text-muted'}>
              {formatFieldValue(entry.text.disclosure)}
            </p>
            {showInternalNotes && (
              <p className="m-0 text-xs text-text-muted whitespace-pre-wrap">
                内部メモ（開示しない）: {entry.text.internalNote ?? '未入力'}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
