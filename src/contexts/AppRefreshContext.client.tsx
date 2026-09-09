'use client';

// ヘッダー右肩の「最新データに更新」を各画面のデータ取得につなぐ Context。
// 画面側は useAppRefresh().refreshToken を取得系 useEffect の依存に入れるだけでよく、
// ヘッダーが個々の画面の取得関数を知る必要がない。

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { AppRefreshContext } from './appRefreshContextValue';

export const AppRefreshProvider = ({ children }: { children: ReactNode }) => {
  const [refreshToken, setRefreshToken] = useState(0);

  const requestRefresh = useCallback(() => {
    setRefreshToken(previous => previous + 1);
  }, []);

  const value = useMemo(() => ({ refreshToken, requestRefresh }), [refreshToken, requestRefresh]);

  return <AppRefreshContext.Provider value={value}>{children}</AppRefreshContext.Provider>;
};
