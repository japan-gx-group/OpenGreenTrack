'use client';

import { useEffect, useState } from 'react';
import { listSsbjEvidence } from '../services/evidenceService';
import type { SsbjEvidence } from '../types';

export function useSsbjEvidence(reportId: string, enabled: boolean) {
  const [items, setItems] = useState<SsbjEvidence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    listSsbjEvidence(reportId)
      .then(records => { if (active) { setItems(records); setErrorMessage(''); } })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : '根拠文書の取得に失敗しました');
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [reportId, enabled]);

  const upsert = (item: SsbjEvidence) => setItems(previous =>
    [...previous.filter(existing => existing.id !== item.id), item]
      .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.id.localeCompare(b.id)),
  );
  const remove = (id: string) => setItems(previous => previous.filter(item => item.id !== id));
  return { items, isLoading, errorMessage, upsert, remove };
}
