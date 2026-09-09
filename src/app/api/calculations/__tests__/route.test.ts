import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  runCalculationBatch: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/currentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

// getRequestLogger は next/headers に依存するため、Route の単体テストではモックする。
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: vi.fn(async () => mocks.log),
}));

vi.mock('@/features/calculation/services/calculationService', () => ({
  runCalculationBatch: mocks.runCalculationBatch,
}));

import {
  ApiRequestError,
  CALCULATION_PENDING_RETRY_AFTER_SECONDS,
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  RateLimitExceededError,
} from '@/lib/security/apiRateLimit';
import { POST } from '../route';

const postRequest = (body: unknown) =>
  new Request('http://localhost/api/calculations', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const validBody = { organizationId: 'org-id', fiscalYearId: 'fy-id' };

describe('POST /api/calculations のレート制限応答', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ organizationId: 'org-id' });
  });

  it('同時実行制限では429と処理時間目安のRetry-Afterを返す', async () => {
    mocks.runCalculationBatch.mockRejectedValue(
      new RateLimitExceededError(
        '算定処理がすでに実行中です。完了後に再度お試しください。',
        CALCULATION_PENDING_RETRY_AFTER_SECONDS,
      ),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(
      String(CALCULATION_PENDING_RETRY_AFTER_SECONDS),
    );
    await expect(response.json()).resolves.toEqual({
      error: '算定処理がすでに実行中です。完了後に再度お試しください。',
    });
  });

  it('1分あたりの制限では窓幅と一致するRetry-Afterを返す', async () => {
    mocks.runCalculationBatch.mockRejectedValue(
      new RateLimitExceededError('算定リクエストが上限に達しました。', RATE_LIMIT_RETRY_AFTER_SECONDS),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(String(RATE_LIMIT_RETRY_AFTER_SECONDS));
  });

  it('存在しない算定年度では400を返し、Retry-Afterは付けない', async () => {
    mocks.runCalculationBatch.mockRejectedValue(
      new ApiRequestError('算定年度が見つかりません', 400),
    );

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(400);
    expect(response.headers.get('Retry-After')).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: '算定年度が見つかりません' });
  });

  it('想定外のエラーは詳細を伏せて500を返す', async () => {
    mocks.runCalculationBatch.mockRejectedValue(new Error('column "foo" does not exist'));

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'サーバー内部エラーが発生しました',
    });
    expect(mocks.log.error).toHaveBeenCalled();
  });
});
