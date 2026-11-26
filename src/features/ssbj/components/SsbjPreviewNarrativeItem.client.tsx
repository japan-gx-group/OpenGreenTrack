'use client';

// 2 画面エディタの右のプレビューで、文章の 1 項目を、左の入力カードへ移れるようにした表示（SsbjPreviewNarratives が itemFocus を
// 受けたときだけ使う）。項目 ID の目印を付け、左で扱っている項目を目立たせ、編集中なら「編集中」と出す。
// 項目のどこを押しても左へ移る。キーボードでは項目名のボタンで移る（押した click がこの枠まで伝わる）。
// プレビューの文を選んでコピーしようとしている（文字を選択している）ときは、項目名のボタン以外を押しても移らない。

import type { ReactNode } from 'react';
import type { SsbjItemId } from '../types';
import { SSBJ_PREVIEW_ITEM_ATTRIBUTE } from '../utils/editorScroll';

interface SsbjPreviewNarrativeItemProps {
  itemId: SsbjItemId;
  label: string;
  /** 項目名の後ろに添える表示（項番号など）。 */
  labelNote?: ReactNode;
  isActive: boolean;
  isEditing: boolean;
  onSelect: (itemId: SsbjItemId) => void;
  children: ReactNode;
}

const itemClassName = (isActive: boolean): string =>
  isActive
    ? 'flex cursor-pointer flex-col gap-1 rounded-md bg-primary-light px-2 py-1 ring-2 ring-primary'
    : 'flex cursor-pointer flex-col gap-1 rounded-md px-2 py-1 hover:bg-bg-subtle';

const hasTextSelection = (): boolean => {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString() !== '';
};

export const SsbjPreviewNarrativeItem = ({
  itemId, label, labelNote, isActive, isEditing, onSelect, children,
}: SsbjPreviewNarrativeItemProps) => (
  <div
    {...{ [SSBJ_PREVIEW_ITEM_ATTRIBUTE]: itemId }}
    data-active={isActive || undefined}
    className={itemClassName(isActive)}
    onClick={event => {
      const onButton = event.target instanceof Element && event.target.closest('button') !== null;
      if (!onButton && hasTextSelection()) return;
      onSelect(itemId);
    }}
  >
    <h4 className="m-0 text-sm font-bold">
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        aria-label={`「${label}」の入力へ移る`}
        className="cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left font-bold text-inherit hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {label}
      </button>
      {isEditing && <span className="ml-2 text-xs font-semibold text-primary">編集中</span>}
      {labelNote}
    </h4>
    {children}
  </div>
);
