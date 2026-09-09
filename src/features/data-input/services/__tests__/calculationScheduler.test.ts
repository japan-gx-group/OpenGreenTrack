import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalculationScheduler, type CalculationSchedulerState } from '../calculationScheduler';
import type { CalculationBatchRequestResult } from '../autoCalculation';

// レート制限（429）で弾かれた自動算定の持ち越し・相乗り・自動再試行・諦めを固定する。

const completed = (processedCount = 1): CalculationBatchRequestResult => ({
  kind: 'completed',
  processedCount,
  totalEmissionsDelta: processedCount,
  unresolvedReasons: [],
  factorWarningCount: 0,
});
const rateLimited = (retryAfterSeconds: number): CalculationBatchRequestResult => ({
  kind: 'rateLimited',
  message: '混雑中',
  retryAfterSeconds,
});

const flushPromises = async () => {
  // 直列キュー（Promise.then の連鎖）を進めるため、マイクロタスクを数回回す。
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

const setup = (
  execute: (fiscalYearId: string) => Promise<CalculationBatchRequestResult>,
  maxRetryAttempts?: number,
) => {
  const states: CalculationSchedulerState[] = [];
  const onRetryFinished = vi.fn();
  const scheduler = new CalculationScheduler({
    execute,
    onStateChange: (state) => states.push(state),
    onRetryFinished,
    maxRetryAttempts,
  });
  return { scheduler, states, onRetryFinished };
};

describe('CalculationScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('成功時は結果をそのまま返し、待機状態にならない', async () => {
    const execute = vi.fn(async () => completed(2));
    const { scheduler, states } = setup(execute);

    const result = await scheduler.run(['fy-1']);

    expect(result.processedCount).toBe(2);
    expect(result.deferredFiscalYearIds).toEqual([]);
    expect(scheduler.getState()).toEqual({ isRunning: false, pendingFiscalYearIds: [], retryAt: null });
    expect(states.map((s) => s.isRunning)).toEqual([true, false]);
  });

  it('429 の年度は持ち越し、Retry-After 後に自動で再試行して結果を通知する', async () => {
    const execute = vi.fn<(id: string) => Promise<CalculationBatchRequestResult>>();
    execute.mockResolvedValueOnce(rateLimited(60)).mockResolvedValueOnce(completed(3));
    const { scheduler, onRetryFinished } = setup(execute);

    const result = await scheduler.run(['fy-1']);

    expect(result.deferredFiscalYearIds).toEqual(['fy-1']);
    expect(result.retryAfterSeconds).toBe(60);
    expect(scheduler.getState().pendingFiscalYearIds).toEqual(['fy-1']);
    expect(scheduler.getState().retryAt).toBe(Date.now() + 60_000);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(execute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith('fy-1');
    expect(onRetryFinished).toHaveBeenCalledTimes(1);
    const [retryResult, gaveUp] = onRetryFinished.mock.calls[0];
    expect(retryResult.processedCount).toBe(3);
    expect(gaveUp).toBe(false);
    expect(scheduler.getState()).toEqual({ isRunning: false, pendingFiscalYearIds: [], retryAt: null });
  });

  it('待機中に同じ年度を保存しても API は呼ばず、予定済みの再試行に相乗りする', async () => {
    const execute = vi.fn<(id: string) => Promise<CalculationBatchRequestResult>>();
    execute.mockResolvedValueOnce(rateLimited(60)).mockResolvedValue(completed(1));
    const { scheduler, onRetryFinished } = setup(execute);

    await scheduler.run(['fy-1']);
    await vi.advanceTimersByTimeAsync(20_000);

    const joined = await scheduler.run(['fy-1']);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(joined.deferredFiscalYearIds).toEqual(['fy-1']);
    // 残り時間（40秒）を案内し、元の予定は動かさない。
    expect(joined.retryAfterSeconds).toBe(40);
    expect(scheduler.getState().pendingFiscalYearIds).toEqual(['fy-1']);

    await vi.advanceTimersByTimeAsync(40_000);
    await flushPromises();

    // 再試行は年度あたり 1 回だけ（バッチが年度の未算定を全件処理する）。
    expect(execute).toHaveBeenCalledTimes(2);
    expect(onRetryFinished).toHaveBeenCalledTimes(1);
  });

  it('待機中に別の年度が弾かれたら同じ再試行にまとめ、予定を早めない', async () => {
    const execute = vi.fn<(id: string) => Promise<CalculationBatchRequestResult>>();
    execute
      .mockResolvedValueOnce(rateLimited(60))
      .mockResolvedValueOnce(rateLimited(30))
      .mockResolvedValue(completed(1));
    const { scheduler } = setup(execute);

    await scheduler.run(['fy-1']);
    const firstRetryAt = scheduler.getState().retryAt;
    await vi.advanceTimersByTimeAsync(10_000);
    await scheduler.run(['fy-2']);

    expect(scheduler.getState().pendingFiscalYearIds).toEqual(['fy-1', 'fy-2']);
    expect(scheduler.getState().retryAt).toBe(firstRetryAt);

    await vi.advanceTimersByTimeAsync(50_000);
    await flushPromises();

    expect(execute.mock.calls.slice(2).map(([id]) => id)).toEqual(['fy-1', 'fy-2']);
  });

  it('runNow は待機を取り消して待機中の年度と指定年度をまとめて今すぐ実行する', async () => {
    const execute = vi.fn<(id: string) => Promise<CalculationBatchRequestResult>>();
    execute.mockResolvedValueOnce(rateLimited(60)).mockResolvedValue(completed(1));
    const { scheduler, onRetryFinished } = setup(execute);

    await scheduler.run(['fy-1']);
    const result = await scheduler.runNow(['fy-2', 'fy-1']);

    expect(execute.mock.calls.slice(1).map(([id]) => id)).toEqual(['fy-1', 'fy-2']);
    expect(result.processedCount).toBe(2);
    expect(scheduler.getState()).toEqual({ isRunning: false, pendingFiscalYearIds: [], retryAt: null });

    // 取り消したタイマーは発火しない。
    await vi.advanceTimersByTimeAsync(120_000);
    await flushPromises();
    expect(execute).toHaveBeenCalledTimes(3);
    expect(onRetryFinished).not.toHaveBeenCalled();
  });

  it('再試行が連続して弾かれたら上限で諦め、gaveUp=true で通知して待機を解除する', async () => {
    const execute = vi.fn(async () => rateLimited(1));
    const { scheduler, onRetryFinished } = setup(execute, 2);

    await scheduler.run(['fy-1']);

    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    expect(onRetryFinished).toHaveBeenCalledTimes(1);
    expect(onRetryFinished.mock.calls[0][1]).toBe(false);
    expect(scheduler.getState().retryAt).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    expect(onRetryFinished).toHaveBeenCalledTimes(2);
    expect(onRetryFinished.mock.calls[1][1]).toBe(true);
    expect(scheduler.getState()).toEqual({ isRunning: false, pendingFiscalYearIds: [], retryAt: null });

    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('ユーザー操作の run は再試行回数をリセットする（操作が続く限り諦めない）', async () => {
    const execute = vi.fn(async () => rateLimited(1));
    const { scheduler, onRetryFinished } = setup(execute, 2);

    await scheduler.run(['fy-1']);
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    expect(onRetryFinished).toHaveBeenCalledTimes(1);

    // 2 回目の再試行の前に別の保存（別年度）が入る。
    await scheduler.run(['fy-2']);
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(onRetryFinished).toHaveBeenCalledTimes(2);
    expect(onRetryFinished.mock.calls[1][1]).toBe(false);
  });

  it('実行は直列化される（同時に呼んでも API は同時に走らない）', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const execute = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight -= 1;
      return completed(1);
    });
    const { scheduler } = setup(execute);

    const first = scheduler.run(['fy-1']);
    const second = scheduler.run(['fy-2']);
    await vi.advanceTimersByTimeAsync(300);
    await Promise.all([first, second]);

    expect(maxInFlight).toBe(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('複数年度の run の途中で再試行タイマーが発火しても、相乗り年度を重ねて実行しない', async () => {
    // fy-2 が待機中（1秒後に再試行）。その間に run(['fy-1', 'fy-2']) が走り、fy-1 の execute（2秒かかる）を
    // await している最中にタイマーが発火する。fy-2 は run 側では相乗り扱いのまま、再試行側で 1 回だけ実行されること。
    const execute = vi.fn(async (fiscalYearId: string): Promise<CalculationBatchRequestResult> => {
      if (fiscalYearId === 'fy-1') {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        return completed(1);
      }
      return execute.mock.calls.filter(([id]) => id === 'fy-2').length === 1 ? rateLimited(1) : completed(1);
    });
    const { scheduler, onRetryFinished } = setup(execute);

    await scheduler.run(['fy-2']);
    expect(scheduler.getState().pendingFiscalYearIds).toEqual(['fy-2']);

    const running = scheduler.run(['fy-1', 'fy-2']);
    await vi.advanceTimersByTimeAsync(2_500);
    const result = await running;
    await flushPromises();

    expect(result.deferredFiscalYearIds).toEqual(['fy-2']);
    expect(execute.mock.calls.map(([id]) => id)).toEqual(['fy-2', 'fy-1', 'fy-2']);
    expect(onRetryFinished).toHaveBeenCalledTimes(1);
    expect(scheduler.getState()).toEqual({ isRunning: false, pendingFiscalYearIds: [], retryAt: null });
  });

  it('run の実行中に runNow を呼んでも待機中の年度は 1 回だけ実行され、その後のタイマーは空振りする', async () => {
    const execute = vi.fn(async (fiscalYearId: string): Promise<CalculationBatchRequestResult> => {
      if (fiscalYearId === 'fy-1') {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        return completed(1);
      }
      return execute.mock.calls.filter(([id]) => id === 'fy-2').length === 1 ? rateLimited(1) : completed(1);
    });
    const { scheduler, onRetryFinished } = setup(execute);

    await scheduler.run(['fy-2']);
    const running = scheduler.run(['fy-1', 'fy-2']);
    const manual = scheduler.runNow(['fy-3']);
    await vi.advanceTimersByTimeAsync(2_500);
    await Promise.all([running, manual]);
    await flushPromises();

    // fy-2 は run 側では相乗り、runNow 側で 1 回実行。タイマーの再試行は取り出す年度が無く何もしない。
    expect(execute.mock.calls.map(([id]) => id)).toEqual(['fy-2', 'fy-1', 'fy-2', 'fy-3']);
    expect(onRetryFinished).not.toHaveBeenCalled();
    expect(scheduler.getState()).toEqual({ isRunning: false, pendingFiscalYearIds: [], retryAt: null });
  });

  it('dispose 後はタイマーもコールバックも動かない', async () => {
    const execute = vi.fn<(id: string) => Promise<CalculationBatchRequestResult>>();
    execute.mockResolvedValueOnce(rateLimited(10)).mockResolvedValue(completed(1));
    const { scheduler, onRetryFinished, states } = setup(execute);

    await scheduler.run(['fy-1']);
    const stateCount = states.length;
    scheduler.dispose();

    await vi.advanceTimersByTimeAsync(20_000);
    await flushPromises();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(onRetryFinished).not.toHaveBeenCalled();
    expect(states).toHaveLength(stateCount);
  });
});
