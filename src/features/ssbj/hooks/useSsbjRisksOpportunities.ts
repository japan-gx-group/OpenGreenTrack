'use client';

// レポートのリスク・機会一覧の読込と、登録・更新・削除後の画面反映。
// レポート自体が見つからない間（enabled = false）は読み込まない。

import { useEffect, useState } from 'react';
import { listSsbjRisksOpportunities } from '../services/riskOpportunityService';
import type { SsbjRiskOpportunity } from '../types';

export interface SsbjRisksOpportunitiesState {
  items: SsbjRiskOpportunity[];
  isLoading: boolean;
  errorMessage: string;
  /** 登録・更新した 1 件を一覧へ反映する（同じ ID があれば置き換え、無ければ末尾に足す）。 */
  upsertItem: (item: SsbjRiskOpportunity) => void;
  removeItem: (id: string) => void;
}

export function useSsbjRisksOpportunities(reportId: string, enabled: boolean): SsbjRisksOpportunitiesState {
  const [items, setItems] = useState<SsbjRiskOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (!enabled) return;
    let isMounted = true;

    listSsbjRisksOpportunities(reportId)
      .then(list => {
        if (isMounted) {
          setItems(list);
          setErrorMessage('');
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'リスク・機会の取得に失敗しました');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reportId, enabled]);

  const upsertItem = (item: SsbjRiskOpportunity) => {
    setItems(prev =>
      prev.some(existing => existing.id === item.id)
        ? prev.map(existing => (existing.id === item.id ? item : existing))
        : [...prev, item],
    );
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  return { items, isLoading, errorMessage, upsertItem, removeItem };
}
