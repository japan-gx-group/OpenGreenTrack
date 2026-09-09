import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  CALCULATION_PENDING_RETRY_AFTER_SECONDS,
  CALCULATION_PER_MINUTE_LIMIT,
  HEAVY_API_SQLSTATE,
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  RateLimitExceededError,
  getCalculationRateLimitError,
  getCalculationRequestError,
} from '../apiRateLimit';

describe('getCalculationRateLimitError', () => {
  it('算定の同時実行制限コードを429用エラーへ変換する', () => {
    const error = getCalculationRateLimitError({
      code: HEAVY_API_SQLSTATE.calculationPending,
    });

    expect(error).toBeInstanceOf(RateLimitExceededError);
    expect(error?.retryAfterSeconds).toBe(CALCULATION_PENDING_RETRY_AFTER_SECONDS);
    expect(error?.message).toContain('すでに実行中');
  });

  it('算定の短時間連打制限コードを429用エラーへ変換する', () => {
    const error = getCalculationRateLimitError({
      code: HEAVY_API_SQLSTATE.calculationRecent,
    });

    expect(error).toBeInstanceOf(RateLimitExceededError);
    expect(error?.retryAfterSeconds).toBe(RATE_LIMIT_RETRY_AFTER_SECONDS);
    expect(error?.message).toContain(`1分あたり${CALCULATION_PER_MINUTE_LIMIT}件まで`);
  });

  it('未知のDBエラーコードは変換しない', () => {
    expect(getCalculationRateLimitError({ code: 'P9999' })).toBeNull();
  });

  it('既存のpending一意制約違反を429用エラーへ変換する', () => {
    const error = getCalculationRateLimitError({ code: '23505' });

    expect(error).toBeInstanceOf(RateLimitExceededError);
    expect(error?.retryAfterSeconds).toBe(CALCULATION_PENDING_RETRY_AFTER_SECONDS);
    expect(error?.message).toContain('この算定年度');
    // 前回が中断されたまま残っている場合に恒久ブロックを示唆しない
    expect(error?.message).not.toContain('完了までお待ちください');
    expect(error?.message).toContain('時間をおいて');
  });
});

describe('getCalculationRequestError', () => {
  it('存在しない会計年度コードを400用エラーへ変換する', () => {
    const error = getCalculationRequestError({
      code: HEAVY_API_SQLSTATE.calculationFiscalYearInvalid,
    });

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error?.status).toBe(400);
    expect(error?.message).toContain('算定年度');
  });
});
