'use client';

// OGT の候補値の採用・取り消し（T08b）の状態と送信。利用者がボタンを押したときだけ呼ぶ（自動では採用しない）。

import { useState } from 'react';
import { adoptOgtCandidates, clearOgtAdoption } from '../services/ogtAdoptionService';
import type { OgtCandidateValue, OgtSupplierReference } from '../types';
import { ogtCandidateFingerprint } from '../utils/ogtAdoption';

export const useOgtAdoptionActions = (reportId: string) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const run = async (action: () => Promise<unknown>, fallbackMessage: string): Promise<boolean> => {
    // 連打で同じ操作を 2 回送らない。
    if (isSubmitting) return false;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await action();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : fallbackMessage);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  /** 画面に表示している候補値を採用する（サーバは値を取り直し、表示と同じときだけ保存する）。 */
  const adopt = (candidates: readonly OgtCandidateValue[], suppliers: readonly OgtSupplierReference[]) =>
    run(() => adoptOgtCandidates(reportId, ogtCandidateFingerprint(candidates, suppliers)), 'OGT の値の採用に失敗しました');

  const clear = () => run(() => clearOgtAdoption(reportId), '採用の取り消しに失敗しました');

  return { isSubmitting, errorMessage, adopt, clear };
};
