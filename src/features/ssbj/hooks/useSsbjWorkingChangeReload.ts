'use client';

// 作業中の内容が書き換わった知らせ（utils/workingChange.ts）を受けて、少し間を置いて reload を呼ぶ。
// 続けて保存したとき（一覧で続けて選ぶなど）は、最後の知らせから間を置いて 1 回だけ読み直す。reportId が null のときは受けない。

import { useEffect, useRef } from 'react';
import { onSsbjWorkingChanged } from '../utils/workingChange';

/** 知らせから読み直すまでの間（ミリ秒）。 */
export const SSBJ_WORKING_RELOAD_DELAY_MS = 800;

export const useSsbjWorkingChangeReload = (reportId: string | null, reload: () => void): void => {
  // 最新の reload を呼ぶ（reload は描画ごとに作り直されるので、知らせの受け直しをしないため ref に置く）。
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; });

  useEffect(() => {
    if (!reportId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = onSsbjWorkingChanged(reportId, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; reloadRef.current(); }, SSBJ_WORKING_RELOAD_DELAY_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [reportId]);
};
