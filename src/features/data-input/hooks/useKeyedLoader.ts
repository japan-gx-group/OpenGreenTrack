'use client';

// キー付きの非同期ローダー（データ入力フォームの係数マスタ・事業者別係数・IDEA 製品詳細の取得に使う）。
//
// ロード状態はキーごとの ready | error として持ち、「取得中」は「キーが未登録」から派生させる。
// boolean のローディングフラグでは、年度 A（取得済）→ B（取得中）→ A と往復したときや、
// 会計年度マスタの到着で適用年度が変わったときに、B の完了が破棄されてフラグが true のまま固着する。
//   - effect 冒頭で同期 setState をしない（react-hooks/set-state-in-effect 対策のマイクロタスク逃がしが不要）
//   - クリーンアップで結果を捨てない（キー付きの結果は常に有効なキャッシュ）
//   - 二重リクエストは in-flight 集合で防ぐ（StrictMode の dev 二重実行にも効く）
//   - error もキーごとに保持し early return 条件に含める（含めないと error → 再取得ループになる）
// 失敗したキーは retry() で明示的に破棄したときだけ再取得する（暗黙の再試行ループを作らない）。

import { useCallback, useEffect, useRef, useState } from 'react';

export type KeyedLoadState<T> =
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };

export interface KeyedLoader<T> {
  /** key が null または未取得なら undefined。 */
  state: KeyedLoadState<T> | undefined;
  /** key !== null かつ未取得。 */
  isLoading: boolean;
  /** 現在のキーの取得失敗を破棄して再取得する（失敗していなければ何もしない）。 */
  retry: () => void;
}

/**
 * @param key   取得キー。null のときは何も取得しない
 * @param load  キーからデータを取得する関数。モジュールスコープの関数か useCallback 済みの安定した参照を渡すこと
 * @param errorMessage 取得失敗時に state.message へ入れる文言
 */
export function useKeyedLoader<K extends string | number, T>(
  key: K | null,
  load: (key: K) => Promise<T>,
  errorMessage: string,
): KeyedLoader<T> {
  const [cache, setCache] = useState<Partial<Record<K, KeyedLoadState<T>>>>({});
  const inFlightRef = useRef(new Set<K>());

  useEffect(() => {
    if (key === null || cache[key] !== undefined || inFlightRef.current.has(key)) {
      return;
    }
    const inFlight = inFlightRef.current;
    inFlight.add(key);
    load(key)
      .then((value) => {
        setCache((prev) => ({ ...prev, [key]: { status: 'ready', value } }));
      })
      .catch(() => {
        setCache((prev) => ({ ...prev, [key]: { status: 'error', message: errorMessage } }));
      })
      .finally(() => {
        inFlight.delete(key);
      });
    // クリーンアップで結果を捨てない（キー付きの結果は常に有効なキャッシュ）。
  }, [key, cache, load, errorMessage]);

  const retry = useCallback(() => {
    if (key === null) {
      return;
    }
    setCache((prev) => {
      if (prev[key]?.status !== 'error') {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [key]);

  const state = key === null ? undefined : cache[key];
  return { state, isLoading: key !== null && state === undefined, retry };
}
