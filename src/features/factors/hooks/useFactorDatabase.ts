'use client';

// 排出係数マスタの読込。画面を開いたときと、ヘッダーの更新ボタン（refreshToken）で再取得する。
// 取得結果は画面内の作成・更新・削除・CSV取込がその場で書き換えるため setDatabase も公開する。

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import type { ShowToast } from '@/hooks/useToast';
import { getEmissionFactors, type EmissionFactor } from '../services/factorService';

export interface FactorDatabase {
  database: EmissionFactor[];
  setDatabase: Dispatch<SetStateAction<EmissionFactor[]>>;
  /** 一覧の取得中 */
  isLoading: boolean;
  /** 取得失敗でも database は空のままなので、「未登録」と区別するために失敗を別に持つ。 */
  loadFailed: boolean;
}

export function useFactorDatabase(showToast: ShowToast): FactorDatabase {
  const { refreshToken } = useAppRefresh();
  const [database, setDatabase] = useState<EmissionFactor[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const loadEmissionFactors = async () => {
      setIsLoading(true);

      try {
        const factors = await getEmissionFactors();
        if (isMounted) {
          setDatabase(factors);
          setLoadFailed(false);
        }
      } catch (error) {
        if (isMounted) {
          setLoadFailed(true);
          showToast(error instanceof Error ? error.message : '排出係数の取得に失敗しました', 'error');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadEmissionFactors();

    return () => {
      isMounted = false;
    };
  }, [showToast, refreshToken]);

  return { database, setDatabase, isLoading, loadFailed };
}
