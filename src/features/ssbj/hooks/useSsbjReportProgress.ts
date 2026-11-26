'use client';

// レポートの進み具合（utils/reportProgress.ts）を、作業中の内容（プレビューの元データ）から数える。
// 作業中の内容の取得は、プレビューと同じ useSsbjPreviewSource を使う。reportId が null（閲覧者など）のときは読まない。
// 読み直している間（reload の後）は、前に数えた値をそのまま返す（タブの数が一瞬消えないように）。

import { useMemo, useState } from 'react';
import type { SsbjSnapshotSections } from '../types';
import { ssbjReportProgress, type SsbjReportProgress } from '../utils/reportProgress';
import { useSsbjPreviewSource } from './useSsbjPreviewSource';

const WORKING = { kind: 'working' } as const;

export interface SsbjReportProgressState {
  progress: SsbjReportProgress | null;
  /** 数えた元の作業中の内容（依頼の前の点検表で、判断と文章の食い違い・採用した OGT の値を見るのに使う）。 */
  sections: Partial<SsbjSnapshotSections> | null;
  isLoading: boolean;
  errorMessage: string;
  /** 作業中の内容を読み直す（前の値は読み終わるまで残す）。 */
  reload: () => void;
}

export const useSsbjReportProgress = (reportId: string | null): SsbjReportProgressState => {
  const { source, isLoading, errorMessage, reload } = useSsbjPreviewSource(reportId, WORKING);
  const loaded = source?.snapshot.sections ?? null;
  // 最後に読めた内容（どのレポートのものかと一緒に持つ）。描画中に更新する（React の「前の値を覚える」書き方）。
  const [last, setLast] = useState<{ reportId: string; sections: Partial<SsbjSnapshotSections> } | null>(null);
  if (reportId && loaded && last?.sections !== loaded) setLast({ reportId, sections: loaded });
  const sections = loaded ?? (reportId && last?.reportId === reportId && !errorMessage ? last.sections : null);
  const progress = useMemo(() => (sections ? ssbjReportProgress(sections) : null), [sections]);
  return { progress, sections, isLoading, errorMessage, reload };
};
