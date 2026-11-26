'use client';

// 該当性・重要性の判断の一覧で、まとめて判断を付ける要求の選択（チェック）を持つ。
// 選択は画面の中だけの状態で、保存はしない。まとめて付けて保存できた要求は、呼び出し元が選択から外す。

import { useCallback, useState } from 'react';
import type { SsbjRequirementId } from '../types';

export interface SsbjJudgementSelection {
  selected: ReadonlySet<SsbjRequirementId>;
  isSelected: (requirementId: SsbjRequirementId) => boolean;
  /** 1 件を選ぶ・外す。 */
  toggle: (requirementId: SsbjRequirementId, checked: boolean) => void;
  /** まとめて選ぶ・外す（章の見出しのチェック）。 */
  setMany: (requirementIds: readonly SsbjRequirementId[], checked: boolean) => void;
  /** 指定した要求を選択から外す。指定が無ければ全部外す。 */
  clear: (requirementIds?: readonly SsbjRequirementId[]) => void;
}

export function useSsbjJudgementSelection(): SsbjJudgementSelection {
  const [selected, setSelected] = useState<ReadonlySet<SsbjRequirementId>>(new Set());

  const setMany = useCallback((requirementIds: readonly SsbjRequirementId[], checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of requirementIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  return {
    selected,
    isSelected: requirementId => selected.has(requirementId),
    toggle: (requirementId, checked) => setMany([requirementId], checked),
    setMany,
    clear: requirementIds => {
      if (!requirementIds) setSelected(new Set());
      else setMany(requirementIds, false);
    },
  };
}
