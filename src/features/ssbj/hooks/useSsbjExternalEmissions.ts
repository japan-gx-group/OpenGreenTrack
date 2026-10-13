'use client';

// 外部で算定した排出量（外部算定値）の一覧の読込と、保存・削除の後の差し替え。

import { useEffect, useState } from 'react';
import { listSsbjExternalEmissions } from '../services/externalEmissionService';
import type { SsbjExternalEmission } from '../types';

const order = (a: SsbjExternalEmission, b: SsbjExternalEmission): number =>
  a.scope - b.scope ||
  (a.scope3CategoryId ?? 0) - (b.scope3CategoryId ?? 0) ||
  (a.scope2Basis ?? '').localeCompare(b.scope2Basis ?? '') ||
  a.id.localeCompare(b.id);

export function useSsbjExternalEmissions(reportId: string, enabled: boolean) {
  const [items, setItems] = useState<SsbjExternalEmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    listSsbjExternalEmissions(reportId)
      .then(records => { if (active) { setItems(records); setErrorMessage(''); } })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : '外部算定値の取得に失敗しました');
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [reportId, enabled]);

  const upsert = (item: SsbjExternalEmission) =>
    setItems(previous => [...previous.filter(existing => existing.id !== item.id), item].sort(order));
  const remove = (id: string) => setItems(previous => previous.filter(item => item.id !== id));
  return { items, isLoading, errorMessage, upsert, remove };
}
