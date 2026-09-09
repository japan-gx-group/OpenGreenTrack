import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT_RETRY_AFTER_SECONDS } from '@/lib/security/apiRateLimit';
import {
  accumulateBatchResult,
  buildCalculationMessages,
  createEmptyRunResult,
  parseRetryAfterSeconds,
  requestCalculationBatch,
} from '../autoCalculation';

// 自動算定の応答解釈（特に 429 と Retry-After）とトースト文言の組み立てを固定する。

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('parseRetryAfterSeconds', () => {
  it('秒数をそのまま返し、小数は切り上げる', () => {
    expect(parseRetryAfterSeconds('30')).toBe(30);
    expect(parseRetryAfterSeconds('2.2')).toBe(3);
  });

  it('欠落・非数値は1分制限の窓幅を既定値にする', () => {
    expect(parseRetryAfterSeconds(null)).toBe(RATE_LIMIT_RETRY_AFTER_SECONDS);
    expect(parseRetryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(RATE_LIMIT_RETRY_AFTER_SECONDS);
  });

  it('異常値は上下限へ丸める', () => {
    expect(parseRetryAfterSeconds('0')).toBe(1);
    expect(parseRetryAfterSeconds('-5')).toBe(1);
    expect(parseRetryAfterSeconds('99999')).toBe(300);
  });
});

describe('requestCalculationBatch', () => {
  it('organizationId と fiscalYearId を POST し、成功応答を completed に変換する', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        processedCount: 2,
        totalEmissionsDelta: 1.5,
        unresolved: [{ reason: 'UNIT_MISMATCH' }, { reason: 'unknown-reason' }, {}],
        warnings: [{ reason: 'EXPLICIT_FACTOR_REMAPPED' }, { reason: 'EXPLICIT_FACTOR_FALLBACK' }],
      }),
    );

    const result = await requestCalculationBatch('org-1', 'fy-1', fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith('/api/calculations', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      organizationId: 'org-1',
      fiscalYearId: 'fy-1',
    });
    // 未知の理由・理由なしは「係数なし」に寄せる。
    expect(result).toEqual({
      kind: 'completed',
      processedCount: 2,
      totalEmissionsDelta: 1.5,
      unresolvedReasons: ['UNIT_MISMATCH', 'FACTOR_NOT_FOUND', 'FACTOR_NOT_FOUND'],
      factorWarningCount: 2,
    });
  });

  it('429 は失敗ではなく持ち越しとして Retry-After を返す', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(429, { error: '混雑中' }, { 'Retry-After': '30' }));

    const result = await requestCalculationBatch('org-1', 'fy-1', fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ kind: 'rateLimited', message: '混雑中', retryAfterSeconds: 30 });
  });

  it('その他のエラー応答は failed にし、本文のエラー文言を使う', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { errorMessage: '係数の取得に失敗しました' }));

    const result = await requestCalculationBatch('org-1', 'fy-1', fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ kind: 'failed', message: '係数の取得に失敗しました' });
  });

  it('ネットワーク例外は throw せず failed にする', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await requestCalculationBatch('org-1', 'fy-1', fetchMock as unknown as typeof fetch);

    expect(result.kind).toBe('failed');
  });
});

describe('accumulateBatchResult', () => {
  it('年度ごとの結果を件数・排出量・未解決理由・持ち越しへ積み上げる', () => {
    const run = createEmptyRunResult();

    accumulateBatchResult(run, 'fy-1', {
      kind: 'completed',
      processedCount: 1,
      totalEmissionsDelta: 0.5,
      unresolvedReasons: ['FACTOR_NOT_FOUND'],
      factorWarningCount: 2,
    });
    accumulateBatchResult(run, 'fy-2', { kind: 'rateLimited', message: '', retryAfterSeconds: 30 });
    accumulateBatchResult(run, 'fy-3', { kind: 'rateLimited', message: '', retryAfterSeconds: 60 });
    accumulateBatchResult(run, 'fy-4', { kind: 'failed', message: 'x' });

    expect(run.processedCount).toBe(1);
    expect(run.totalEmissionsDelta).toBe(0.5);
    expect(run.unresolvedCountByReason.get('FACTOR_NOT_FOUND')).toBe(1);
    expect(run.factorWarningCount).toBe(2);
    expect(run.deferredFiscalYearIds).toEqual(['fy-2', 'fy-3']);
    // 複数年度が持ち越しになったら、いちばん長い Retry-After を守る。
    expect(run.retryAfterSeconds).toBe(60);
    expect(run.failures).toEqual(['x']);
  });
});

describe('buildCalculationMessages', () => {
  it('持ち越しがあれば保存済みであることと自動再試行までの秒数を案内する', () => {
    const run = createEmptyRunResult();
    run.deferredFiscalYearIds = ['fy-1'];
    run.retryAfterSeconds = 45;

    const messages = buildCalculationMessages(run, { uncoveredCount: 0 });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('データは保存済み');
    expect(messages[0]).toContain('約45秒後に自動で再試行');
  });

  it('再試行で処理対象が無かった場合も完了を知らせる', () => {
    expect(buildCalculationMessages(createEmptyRunResult(), { uncoveredCount: 0, isRetry: true })).toEqual([
      '排出量の再計算が完了しました。',
    ]);
    // 保存直後（isRetry=false）で何も無い場合は従来どおり無言（保存トーストが既に出ている）。
    expect(buildCalculationMessages(createEmptyRunResult(), { uncoveredCount: 0 })).toEqual([]);
  });

  it('件数・未解決理由・係数の警告・年度未登録・失敗をこの順で並べる', () => {
    const run = createEmptyRunResult();
    run.processedCount = 3;
    run.totalEmissionsDelta = 12.3456;
    run.unresolvedCountByReason.set('FACTOR_NOT_FOUND', 2);
    run.factorWarningCount = 1;
    run.failures = ['サーバー内部エラーが発生しました'];

    const messages = buildCalculationMessages(run, { uncoveredCount: 1 });

    expect(messages[0]).toBe('排出量の自動計算が完了しました（3件、合計 12.346 t-CO2e）。');
    expect(messages[1]).toMatch(/^2件は/);
    // 算定は成立しているが選択した係数は使われていない。値が出ているぶん気づきにくいので成功時でも知らせる。
    expect(messages[2]).toMatch(/^1件は選択した排出係数を適用できなかったため、別の係数で算定しました/);
    expect(messages[3]).toContain('算定年度が未登録');
    expect(messages[4]).toContain('サーバー内部エラーが発生しました');
  });

  it('係数の警告が無ければその文言は出さない', () => {
    const run = createEmptyRunResult();
    run.processedCount = 1;
    expect(buildCalculationMessages(run, { uncoveredCount: 0 })).toHaveLength(1);
  });
});
