'use client';

// 拠点一覧の読込。画面を開いたときと、ヘッダーの更新ボタン（refreshToken）で再取得する。
// 取得結果は画面内の作成・更新・削除・CSV 取込がその場で書き換えるため setDatabase も公開する。

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import type { ShowToast } from '@/hooks/useToast';
import { getLocations } from '../services/locationService';
import type { LocationRecord } from '../types';

export interface LocationDatabase {
  database: LocationRecord[];
  setDatabase: Dispatch<SetStateAction<LocationRecord[]>>;
  /** 取得中（初回・更新ボタン）。絞り込みは純粋なクライアント処理なので立てない。 */
  isLoading: boolean;
  /**
   * 初回の getLocations() が完了したか。isLoading は保存や再取得でも立つため、
   * 「データ到着前の空一覧」だけを区別するのにこれを使う。これを見ないと初回取得中に
   * 「条件に合致する拠点が見つかりません」がオーバーレイ越しに透けて見える。
   */
  hasFetchedOnce: boolean;
  /** 最後の取得（初回・更新ボタン・取り直し）に失敗した。次に取得できると false に戻る */
  hasError: boolean;
  /** 一覧を丸ごと取り直した回数。ページングを 1 ページ目へ戻す合図（usePagination の resetKey）に使う。 */
  dataVersion: number;
  /** 一覧を取り直す（CSV 取込後に採番された ID と更新後の値を表示へ反映するため）。失敗は throw する。 */
  reload: () => Promise<void>;
}

export function useLocationDatabase(showToast: ShowToast): LocationDatabase {
  const { refreshToken } = useAppRefresh();
  const [database, setDatabase] = useState<LocationRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasFetchedOnce, setHasFetchedOnce] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [dataVersion, setDataVersion] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;

    // ログインユーザーの所属組織の拠点を取得する。
    // effect 本体での同期的な setState は lint（set-state-in-effect）で禁止されているため、
    // ローディング表示の開始は setTimeout(0) のコールバックへ逃がす。
    const loadingTimer = setTimeout(() => {
      if (isMounted) setIsLoading(true);
    }, 0);
    getLocations()
      .then(locations => {
        if (isMounted) {
          setDatabase(locations);
          setDataVersion(version => version + 1);
          setHasError(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasError(true);
          showToast('拠点の取得に失敗しました', 'error');
        }
      })
      .finally(() => {
        clearTimeout(loadingTimer);
        if (isMounted) {
          setIsLoading(false);
          setHasFetchedOnce(true);
        }
      });

    return () => {
      isMounted = false;
      clearTimeout(loadingTimer);
    };
  }, [showToast, refreshToken]);

  const reload = useCallback(async () => {
    // 失敗の表示は取得できるまで消さない（取り直しの間に「見つかりません」がオーバーレイ越しに透けないように）。
    setIsLoading(true);
    try {
      const locations = await getLocations();
      setDatabase(locations);
      setDataVersion(version => version + 1);
      setHasError(false);
    } catch (error) {
      setHasError(true);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { database, setDatabase, isLoading, hasFetchedOnce, hasError, dataVersion, reload };
}
