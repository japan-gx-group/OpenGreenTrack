'use client';

// レポートの時間軸の定義の読込。レポート自体が見つからない間（enabled = false）は読み込まない。
// 保存後の値を画面へ反映できるよう setDefinitions を公開する。

import { useEffect, useState } from 'react';
import { getSsbjTimeHorizons } from '../services/timeHorizonService';
import type { SsbjTimeHorizonDefinitions } from '../types';
import { EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS } from '../utils/timeHorizons';

export interface SsbjTimeHorizonsState {
  definitions: SsbjTimeHorizonDefinitions;
  setDefinitions: (definitions: SsbjTimeHorizonDefinitions) => void;
  isLoading: boolean;
  errorMessage: string;
}

export function useSsbjTimeHorizons(reportId: string, enabled: boolean): SsbjTimeHorizonsState {
  const [definitions, setDefinitions] = useState<SsbjTimeHorizonDefinitions>(EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (!enabled) return;
    let isMounted = true;

    getSsbjTimeHorizons(reportId)
      .then(loaded => {
        if (isMounted) {
          setDefinitions(loaded);
          setErrorMessage('');
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : '時間軸の定義の取得に失敗しました');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reportId, enabled]);

  return { definitions, setDefinitions, isLoading, errorMessage };
}
