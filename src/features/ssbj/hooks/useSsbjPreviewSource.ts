'use client';

// プレビュー（T12）に出す内容の読み込み。選んだものが作業中の内容か保存版かを、結果の kind で必ず区別する。

import { useEffect, useState } from 'react';
import { getSsbjVersionPreview, getSsbjWorkingPreview, type SsbjPreviewSource } from '../services/previewService';
import type { SsbjPreviewSelection } from '../utils/preview';

export const useSsbjPreviewSource = (reportId: string | null, selection: SsbjPreviewSelection) => {
  const [result, setResult] = useState<{ key: string; source: SsbjPreviewSource | null; errorMessage: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 選択はオブジェクトの同一性ではなく中身で比べる（描画のたびに作り直されても読み直さないため）。
  const versionId = selection.kind === 'version' ? selection.versionId : null;
  const key = reportId ? `${reportId}:${versionId ?? 'working'}:${reloadKey}` : '';

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    const load = versionId === null ? getSsbjWorkingPreview(reportId) : getSsbjVersionPreview(reportId, versionId);
    load.then(source => {
      if (active) setResult({ key, source, errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ key, source: null,
          errorMessage: error instanceof Error ? error.message : 'プレビューの取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [reportId, versionId, key]);

  return {
    source: result?.key === key ? result.source : null,
    isLoading: !!reportId && result?.key !== key,
    errorMessage: result?.key === key ? result.errorMessage : '',
    /** 作業中の内容を取り直す（別の画面で編集した後など）。 */
    reload: () => setReloadKey(value => value + 1),
  };
};
