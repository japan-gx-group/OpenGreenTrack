import { describe, expect, it } from 'vitest';
import { createFixedWindowRateLimiter } from '../rateLimit';

describe('createFixedWindowRateLimiter', () => {
  it('allows up to the limit inside one window', () => {
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 1000 });

    expect(limiter.consume('a', 0)).toBe(true);
    expect(limiter.consume('a', 500)).toBe(true);
    expect(limiter.consume('a', 999)).toBe(false);
  });

  it('starts a new window once the previous one expires', () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.consume('a', 0)).toBe(true);
    expect(limiter.consume('a', 999)).toBe(false);
    expect(limiter.consume('a', 1000)).toBe(true);
  });

  it('counts each key separately', () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.consume('a', 0)).toBe(true);
    expect(limiter.consume('b', 0)).toBe(true);
    expect(limiter.consume('a', 0)).toBe(false);
  });

  it('drops expired keys instead of growing without bound', () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });

    expect(limiter.consume('a', 0)).toBe(true);
    expect(limiter.consume('b', 0)).toBe(true);
    // 上限に達しており、まだどのウィンドウも期限切れではないので新しいキーは拒否する
    expect(limiter.consume('c', 0)).toBe(false);
    // 期限切れ後は掃除され、新しいキーを再び追跡できる
    expect(limiter.consume('c', 1000)).toBe(true);
  });

  it('forgets state on reset', () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000 });

    expect(limiter.consume('a', 0)).toBe(true);
    limiter.reset();
    expect(limiter.consume('a', 0)).toBe(true);
  });
});
