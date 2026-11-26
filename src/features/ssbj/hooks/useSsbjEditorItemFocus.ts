'use client';

// 2 画面エディタで、左の入力と右のプレビューの「いま扱っている項目」を結ぶフック。
// - activeItemId: 左で編集を始めた・フォーカスした項目。右のプレビューはその項目まで動いて目立たせる。
// - editRequest: 右のプレビューで押した項目。左のその入力カードが受け取って、そこへ移って編集を始める
//   （閲覧専用・承認済みでロック中は移るだけ）。同じ項目を続けて押しても届くよう、押すたびに seq を増やす。

import { useCallback, useState } from 'react';

export interface SsbjEditorItemFocus<T extends string> {
  activeItemId: T | null;
  /** 左で項目を編集し始めた・フォーカスした。 */
  activate: (itemId: T) => void;
  editRequest: { itemId: T; seq: number } | null;
  /** 右のプレビューで項目を押した。 */
  requestEdit: (itemId: T) => void;
}

export function useSsbjEditorItemFocus<T extends string>(): SsbjEditorItemFocus<T> {
  const [activeItemId, setActiveItemId] = useState<T | null>(null);
  const [editRequest, setEditRequest] = useState<{ itemId: T; seq: number } | null>(null);

  const activate = useCallback((itemId: T) => setActiveItemId(itemId), []);
  const requestEdit = useCallback((itemId: T) => {
    setActiveItemId(itemId);
    setEditRequest(prev => ({ itemId, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  return { activeItemId, activate, editRequest, requestEdit };
}
