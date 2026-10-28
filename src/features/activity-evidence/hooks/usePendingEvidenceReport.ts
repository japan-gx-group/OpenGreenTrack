'use client';

// 画面で使っている、まだ記録に紐づけていない帳票（入力中のフォームの欄・請求書の一括登録の表）の ID を親へ伝える。
// 親（データ入力画面）は「帳票の一覧」に渡し、これから紐づける帳票を削除させない。外れたら（アンマウント）空で伝える。

import { useEffect } from 'react';

export const usePendingEvidenceReport = (
  fileIds: readonly string[],
  onChange: ((fileIds: string[]) => void) | undefined,
) => {
  // 配列は描画のたびに作り直されるため、中身（ID の並び）が変わったときだけ伝える。
  const key = fileIds.join('\n');
  useEffect(() => {
    onChange?.(key === '' ? [] : key.split('\n'));
  }, [key, onChange]);
  useEffect(() => () => onChange?.([]), [onChange]);
};
