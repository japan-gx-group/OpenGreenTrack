'use client';

// 承認した保存版の開示する内容の読み込み（閲覧者のプレビュー・印刷ビューで使う）。閲覧者は保存版の行を読めない（RLS）ため、
// 内部メモ・内部記録を除いた版を API から読む（docs/authorization-matrix.md §2.3）。reportId が null の間は読まない。

import { useEffect, useMemo, useState } from 'react';
import type { SsbjPreviewSource } from '../services/previewService';
import { getSsbjApprovedVersion, type SsbjApprovedVersion } from '../services/versionExportService';

export const useSsbjApprovedVersion = (reportId: string | null) => {
  const [result, setResult] = useState<
    { reportId: string; version: SsbjApprovedVersion | null; errorMessage: string } | null
  >(null);

  useEffect(() => {
    if (!reportId) return;
    let active = true;
    getSsbjApprovedVersion(reportId).then(version => {
      if (active) setResult({ reportId, version, errorMessage: '' });
    }).catch((error: unknown) => {
      if (active) {
        setResult({ reportId, version: null,
          errorMessage: error instanceof Error ? error.message : '承認した保存版の取得に失敗しました' });
      }
    });
    return () => { active = false; };
  }, [reportId]);

  const current = result?.reportId === reportId ? result : null;
  const version = current?.version ?? null;
  // 描画のたびに作り直さない（印刷ビューは内容が変わったときだけ印刷を始めるため）。
  const source = useMemo<SsbjPreviewSource | null>(() => (version
    ? { kind: 'version', versionId: version.id, versionNumber: version.versionNumber, createdAt: version.createdAt, snapshot: version.snapshot }
    : null), [version]);
  return {
    version,
    /** プレビューに出す内容（保存版として表示する）。 */
    source,
    isLoading: !!reportId && current === null,
    errorMessage: current?.errorMessage ?? '',
  };
};
