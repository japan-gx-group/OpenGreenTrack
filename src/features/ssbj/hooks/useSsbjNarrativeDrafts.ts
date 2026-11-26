'use client';

// ガバナンス・戦略等の文章の画面で、カードが編集中の内容（未保存）を集めておくフック。
// drafts は編集中の全カードの内容で、2 画面エディタのプレビューにだけ反映する（保存はしない）。
// dirtyItemIds は、そのうち保存済みの内容と違う（保存しないと消える）項目で、「未保存 n」と画面を離れる前の確認に使う。

import { useCallback, useState } from 'react';
import type { SsbjDisclosableText, SsbjItemId } from '../types';

export interface SsbjNarrativeDrafts {
  drafts: Partial<Record<SsbjItemId, SsbjDisclosableText>>;
  /** 編集中の内容（未保存）。編集をやめた・保存したときは null。 */
  handleDraftChange: (itemId: SsbjItemId, text: SsbjDisclosableText | null) => void;
  /** 保存していない入力がある項目（カードの並びではなく、変わった順）。 */
  dirtyItemIds: readonly SsbjItemId[];
  handleDirtyChange: (itemId: SsbjItemId, dirty: boolean) => void;
}

export function useSsbjNarrativeDrafts(): SsbjNarrativeDrafts {
  // 編集中（未保存）の文章。プレビューにだけ反映する。
  const [drafts, setDrafts] = useState<Partial<Record<SsbjItemId, SsbjDisclosableText>>>({});
  const [dirtyItemIds, setDirtyItemIds] = useState<readonly SsbjItemId[]>([]);

  const handleDraftChange = useCallback((itemId: SsbjItemId, text: SsbjDisclosableText | null) => {
    setDrafts(prev => {
      if (text === null) {
        if (!(itemId in prev)) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: text };
    });
  }, []);

  const handleDirtyChange = useCallback((itemId: SsbjItemId, dirty: boolean) => {
    setDirtyItemIds(prev => {
      if (prev.includes(itemId) === dirty) return prev;
      return dirty ? [...prev, itemId] : prev.filter(id => id !== itemId);
    });
  }, []);

  return { drafts, handleDraftChange, dirtyItemIds, handleDirtyChange };
}
