'use client';

// SSBJ レポートの状態の変更（レビュー依頼・取り下げ・承認・差戻し）の入力・送信。
// 権限・遷移・競合の検証はサーバ（RPC）が行う。成功したら onChanged で呼び出し元にレポートを読み直させる。

import { useState } from 'react';
import { changeSsbjReportStatus, type SsbjReportStatusChangeResult } from '../services/reportWorkflowClient';
import type { SsbjReportStatusAction, SsbjReportWorkingRecord } from '../types';

const COMMENT_MAX_LENGTH = 1000;

export interface SsbjReportStatusController {
  approverUserId: string;
  setApproverUserId: (userId: string) => void;
  comment: string;
  setComment: (comment: string) => void;
  isSaving: boolean;
  errorMessage: string;
  /** 送信する。成功したら結果を、検証・送信に失敗したら null を返す。 */
  run: (action: SsbjReportStatusAction) => Promise<SsbjReportStatusChangeResult | null>;
}

export const useSsbjReportStatus = (
  report: SsbjReportWorkingRecord,
  onChanged: (result: SsbjReportStatusChangeResult) => void,
): SsbjReportStatusController => {
  const [approverUserId, setApproverUserId] = useState<string>(report.review.approverUserId ?? '');
  const [comment, setComment] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const run = async (action: SsbjReportStatusAction): Promise<SsbjReportStatusChangeResult | null> => {
    if (isSaving) return null;
    if (action === 'submit' && approverUserId === '') {
      setErrorMessage('承認者を選んでください');
      return null;
    }
    if (comment.length > COMMENT_MAX_LENGTH) {
      setErrorMessage(`コメントは${COMMENT_MAX_LENGTH}文字以内で入力してください`);
      return null;
    }
    setIsSaving(true);
    setErrorMessage('');
    try {
      const result = await changeSsbjReportStatus(report.id, {
        action,
        expectedDraftRevision: report.draftRevision,
        approverUserId: action === 'submit' ? approverUserId : null,
        comment: comment.trim() === '' ? null : comment.trim(),
      });
      setComment('');
      onChanged(result);
      return result;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '状態の変更に失敗しました');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  return { approverUserId, setApproverUserId, comment, setComment, isSaving, errorMessage, run };
};
