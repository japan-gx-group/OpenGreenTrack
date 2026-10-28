'use client';

// 「画像を WebP に変換して容量を減らす」の選択（services/convertPreference.ts）を読む・変える。
// 同じ画面の帳票の欄と請求書のカードがこれを使い、片方で切り替えるともう片方にも反映する。
// サーバの描画では「変換しない」として描き、ブラウザで覚えておいた選択に合わせ直す（食い違わないように）。

import { useSyncExternalStore } from 'react';
import { readConvertPreference, subscribeConvertPreference, writeConvertPreference } from '../services/convertPreference';

const serverConvertPreference = () => false;

export const useConvertPreference = () => {
  const convertToWebp = useSyncExternalStore(subscribeConvertPreference, readConvertPreference, serverConvertPreference);
  return { convertToWebp, setConvertToWebp: writeConvertPreference };
};
