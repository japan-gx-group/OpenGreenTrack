// プレビュー（T12）の章ごとの文章（T05。sections.narratives。表示のみ）。
// 要求項目マスターの項目の順に並べ、文章の無い項目は「未入力」と出す（空欄にしない）。項目には答える要求の項番号を添える。
// 内部メモは showInternalNotes のときだけ「開示しない」と明示して出す（docs/ssbj-spec.md §5）。
// 2 画面エディタの右側で使うときだけ itemFocus を渡す。各項目に項目 ID の目印を付け、左で扱っている項目を目立たせ、
// 項目を押す（キーボードでは項目名のボタン）と左のその入力カードへ移る（押せる表示は SsbjPreviewNarrativeItem.client.tsx）。
// プレビュー画面・印刷ビュー・保存版の表示では渡さない（見た目は変わらない）。

import type { SsbjItemId, SsbjNarrative, SsbjSectionId } from '../types';
import { formatFieldValue, isAnswered } from '../utils/fieldValue';
import { ssbjNarrativeEntriesOfSection } from '../utils/narrative';
import { formatParagraphReference, ssbjRequirementsOfItem } from '../utils/requirementMaster';
import { SsbjPreviewNarrativeItem } from './SsbjPreviewNarrativeItem.client';

/** 2 画面エディタの左の入力と、右のプレビューの項目を結ぶもの。 */
export interface SsbjPreviewItemFocus {
  /** 左で扱っている（編集を始めた・フォーカスした）項目。 */
  activeItemId: SsbjItemId | null;
  /** 左で編集中の項目。 */
  editingItemIds: readonly SsbjItemId[];
  /** プレビューの項目を押した。 */
  onSelect: (itemId: SsbjItemId) => void;
}

export const SsbjPreviewNarratives = ({
  sectionId,
  narratives,
  showInternalNotes,
  itemFocus,
}: {
  sectionId: SsbjSectionId;
  narratives: SsbjNarrative[] | undefined;
  showInternalNotes: boolean;
  itemFocus?: SsbjPreviewItemFocus;
}) => {
  if (narratives === undefined) {
    return <p className="m-0 text-sm text-text-muted">この版にはガバナンス・戦略等の文章が含まれていません。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {ssbjNarrativeEntriesOfSection(sectionId, narratives).map(entry => {
        const references = ssbjRequirementsOfItem(entry.itemId)
          .flatMap(requirement => requirement.references.slice(0, 1).map(formatParagraphReference));
        const label = entry.item?.label ?? entry.itemId;
        const body = (
          <>
            <p className={isAnswered(entry.text.disclosure) ? 'm-0 text-sm whitespace-pre-wrap' : 'm-0 text-sm text-text-muted'}>
              {formatFieldValue(entry.text.disclosure)}
            </p>
            {showInternalNotes && (
              <p className="m-0 text-xs text-text-muted whitespace-pre-wrap">
                内部メモ（開示しない）: {entry.text.internalNote ?? '未入力'}
              </p>
            )}
          </>
        );
        const referenceNote = references.length > 0
          && <span className="ml-2 text-xs font-normal text-text-muted">（{references.join('・')}）</span>;
        if (!itemFocus) {
          return (
            <div key={entry.itemId} className="flex flex-col gap-1">
              <h4 className="m-0 text-sm font-bold">
                {label}
                {referenceNote}
              </h4>
              {body}
            </div>
          );
        }
        return (
          <SsbjPreviewNarrativeItem
            key={entry.itemId}
            itemId={entry.itemId}
            label={label}
            labelNote={referenceNote}
            isActive={itemFocus.activeItemId === entry.itemId}
            isEditing={itemFocus.editingItemIds.includes(entry.itemId)}
            onSelect={itemFocus.onSelect}
          >
            {body}
          </SsbjPreviewNarrativeItem>
        );
      })}
    </div>
  );
};
