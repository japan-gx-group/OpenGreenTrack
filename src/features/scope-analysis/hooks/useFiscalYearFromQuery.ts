'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { SCOPE_ANALYSIS_FISCAL_YEAR_PARAM } from '../utils/scopeAnalysisUrl';

/**
 * URL のクエリ（?fy=<会計年度ID>）で指定された年度を、グローバルの選択年度へ適用する。
 *
 * 選択年度はタブ内の state で永続化されないため、データ入力画面の導線が新しいタブで開かれると
 * 最新年度で表示されてしまう。導線が URL で運んだ年度をここで受け取ることで、
 * どの開き方でも文言どおりの年度で開く。
 *
 * - 登録済みの年度に一致するときだけ適用する（不正・削除済みの ID は無視して既定の最新年度のまま）
 * - 年度一覧のロード完了前は適用を保留し、ロード後に適用する
 * - 同じ指定は一度だけ適用する。適用後に利用者がヘッダーで別の年度を選んでも、
 *   年度一覧の再取得（認証イベント）で URL の年度に引き戻さない
 */
export const useFiscalYearFromQuery = () => {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get(SCOPE_ANALYSIS_FISCAL_YEAR_PARAM);
  const { fiscalYears, setFiscalYearId } = useFiscalYear();
  const appliedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requestedId || appliedIdRef.current === requestedId) return;
    if (!fiscalYears.some(option => option.id === requestedId)) return;
    appliedIdRef.current = requestedId;
    setFiscalYearId(requestedId);
  }, [requestedId, fiscalYears, setFiscalYearId]);
};
