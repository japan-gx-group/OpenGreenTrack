/**
 * プロセス内の固定ウィンドウ方式レートリミッタ。
 *
 * 認証を通さない公開エンドポイント（/api/csp-report）が、外部から無制限に
 * ログ書き込みを駆動されるのを防ぐために使う。インスタンスごとのメモリ上のカウンタなので
 * 水平スケール時は「インスタンス数 × limit」が実効上限になるが、1ホストからの
 * 高頻度な流し込みを止めるには十分で、外部ストアの追加依存も要らない。
 */

type Window = {
  count: number;
  resetAt: number;
};

export type RateLimiter = {
  /** 許可なら true。呼び出しごとにカウントを1つ消費する */
  consume: (key: string, now?: number) => boolean;
  /** テスト用。内部状態を破棄する */
  reset: () => void;
};

export const createFixedWindowRateLimiter = ({
  limit,
  windowMs,
  maxKeys = 10000,
}: {
  limit: number;
  windowMs: number;
  /** 追跡するキー数の上限。IP を詐称して大量のキーを作られてもメモリが膨らまないようにする */
  maxKeys?: number;
}): RateLimiter => {
  const windows = new Map<string, Window>();

  const prune = (now: number) => {
    windows.forEach((window, key) => {
      if (window.resetAt <= now) windows.delete(key);
    });
  };

  const consume = (key: string, now: number = Date.now()): boolean => {
    const current = windows.get(key);

    if (current && current.resetAt > now) {
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    }

    if (windows.size >= maxKeys) {
      prune(now);
      // 期限切れを掃除しても上限に達したままなら、追跡できない分は拒否する（fail closed）。
      // キーを無制限に増やせると上限そのものを回避できてしまうため。
      if (windows.size >= maxKeys) return false;
    }

    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  };

  return {
    consume,
    reset: () => windows.clear(),
  };
};
