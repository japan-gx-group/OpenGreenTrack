'use client';

import { createContext } from 'react';

export type AppRefreshContextValue = {
  /**
   * 「最新データに更新」を押すたびに増える連番。
   * データ取得の useEffect の依存配列に入れておくと、押下のたびに取り直しになる。
   */
  refreshToken: number;
  requestRefresh: () => void;
};

export const AppRefreshContext = createContext<AppRefreshContextValue | null>(null);
