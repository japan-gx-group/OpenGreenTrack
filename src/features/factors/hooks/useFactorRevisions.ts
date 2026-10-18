'use client';

// 詳細モーダルに出すカスタム係数の値・単位の変更履歴（emission_factor_revisions）。
// 公式係数は組織の履歴を持たないため取得しない。

import { useEffect, useState } from 'react';
import { getFactorRevisions, type EmissionFactor, type FactorRevision } from '../services/factorService';

export interface FactorRevisionsState {
  /** 取得済みの履歴（新しい順）。取得中・対象外は null */
  revisions: FactorRevision[] | null;
  loadFailed: boolean;
}

export function useFactorRevisions(factor: EmissionFactor | null): FactorRevisionsState {
  const factorId = factor?.isCustom ? factor.id : null;
  // 取得結果はどの係数のものかと組で持ち、開いている係数と違えば「取得中」として扱う
  // （係数を切り替えた直後に前の係数の履歴を出さないため）。
  const [loaded, setLoaded] = useState<{ factorId: string } & FactorRevisionsState>({
    factorId: '',
    revisions: null,
    loadFailed: false,
  });

  useEffect(() => {
    if (!factorId) return;

    let isMounted = true;
    getFactorRevisions(factorId)
      .then((revisions) => {
        if (isMounted) setLoaded({ factorId, revisions, loadFailed: false });
      })
      .catch(() => {
        if (isMounted) setLoaded({ factorId, revisions: null, loadFailed: true });
      });
    return () => {
      isMounted = false;
    };
  }, [factorId]);

  if (!factorId || loaded.factorId !== factorId) {
    return { revisions: null, loadFailed: false };
  }
  return { revisions: loaded.revisions, loadFailed: loaded.loadFailed };
}
