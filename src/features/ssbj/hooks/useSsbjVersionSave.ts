'use client';

// SSBJ レポートの手動保存（保存版＝固定スナップショットの作成）の状態と送信。
// 自動保存では版を作らない（docs/ssbj-spec.md §8）。利用者がボタンを押したときだけ呼ぶ。

import { useState } from 'react';
import { saveSsbjReportVersion, type SavedSsbjReportVersion } from '../services/versionClient';

export interface SsbjVersionSaveController {
  isSaving: boolean;
  /** 保存に失敗した理由（競合を含む）。次の保存開始で消える。 */
  errorMessage: string;
  /** 保存版を作る。作れたら版を、失敗したら null を返す。 */
  save: (expectedDraftRevision: number) => Promise<SavedSsbjReportVersion | null>;
}

export function useSsbjVersionSave(reportId: string): SsbjVersionSaveController {
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const save = async (expectedDraftRevision: number): Promise<SavedSsbjReportVersion | null> => {
    // 連打で同じ内容の版を 2 つ作らない。
    if (isSaving) return null;

    setIsSaving(true);
    setErrorMessage('');
    try {
      return await saveSsbjReportVersion(reportId, expectedDraftRevision);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存版の作成に失敗しました');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  return { isSaving, errorMessage, save };
}
