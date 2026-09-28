'use client';

// リスク・機会の削除（確認ダイアログの対象と送信）。

import { useState } from 'react';
import { deleteSsbjRiskOpportunity } from '../services/riskOpportunityService';
import type { SsbjRiskOpportunity } from '../types';

export interface SsbjRiskOpportunityDeleteController {
  /** 削除の確認中の対象。確認ダイアログを出していなければ null。 */
  target: SsbjRiskOpportunity | null;
  request: (item: SsbjRiskOpportunity) => void;
  cancel: () => void;
  isDeleting: boolean;
  errorMessage: string;
  /** 削除する。削除できたら対象の ID を、失敗したら null を返す。 */
  confirm: () => Promise<string | null>;
}

export function useSsbjRiskOpportunityDelete(): SsbjRiskOpportunityDeleteController {
  const [target, setTarget] = useState<SsbjRiskOpportunity | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const request = (item: SsbjRiskOpportunity) => {
    setTarget(item);
    setErrorMessage('');
  };

  const cancel = () => {
    if (isDeleting) return;
    setTarget(null);
    setErrorMessage('');
  };

  const confirm = async (): Promise<string | null> => {
    if (!target || isDeleting) return null;
    setIsDeleting(true);
    try {
      await deleteSsbjRiskOpportunity(target.id);
      const deletedId = target.id;
      setTarget(null);
      return deletedId;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'リスク・機会の削除に失敗しました');
      return null;
    } finally {
      setIsDeleting(false);
    }
  };

  return { target, request, cancel, isDeleting, errorMessage, confirm };
}
