// 自動算定の直列実行・持ち越し・自動再試行。
//
// /api/calculations は組織単位のレート制限（同時1件・1分あたりN件）を持つため、保存のたびに
// 呼ぶ自動算定は通常操作（連続入力・複数人での入力）でも 429 に当たり得る。ここでは
//   - 実行を直列化する（同時に投げると自分で同時実行制限に当たる）
//   - 429 になった年度を「持ち越し」として集め、Retry-After 後に 1 回だけまとめて再試行する
//     （待機中に保存した分は同じ再試行に相乗りする。バッチは年度の未算定を全件処理するため 1 回で足りる）
//   - 再試行が続けて弾かれる場合は上限で諦め、手動の再計算導線へ誘導する
// を React に依存しない形で実装する（フックは hooks/useCalculationScheduler.ts）。

import {
  accumulateBatchResult,
  createEmptyRunResult,
  type CalculationBatchRequestResult,
  type CalculationRunResult,
} from './autoCalculation';

export interface CalculationSchedulerState {
  /** /api/calculations を呼んでいる最中か。 */
  isRunning: boolean;
  /** 自動再試行を待っている年度。 */
  pendingFiscalYearIds: string[];
  /** 次の自動再試行の予定時刻（epoch ms）。待機中でなければ null。 */
  retryAt: number | null;
}

export interface CalculationSchedulerDeps {
  /** 1 年度分の算定を実行する（実体は autoCalculation.requestCalculationBatch）。 */
  execute: (fiscalYearId: string) => Promise<CalculationBatchRequestResult>;
  onStateChange: (state: CalculationSchedulerState) => void;
  /**
   * 自動再試行が終わったときに呼ばれる。gaveUp=true は再試行の上限に達して持ち越しを破棄したことを示す。
   * 手動の run() の結果は戻り値で返すため、ここには流れない。
   */
  onRetryFinished: (result: CalculationRunResult, gaveUp: boolean) => void;
  /** 連続して弾かれたときに諦めるまでの自動再試行回数。 */
  maxRetryAttempts?: number;
}

const DEFAULT_MAX_RETRY_ATTEMPTS = 5;

export const INITIAL_SCHEDULER_STATE: CalculationSchedulerState = {
  isRunning: false,
  pendingFiscalYearIds: [],
  retryAt: null,
};

export class CalculationScheduler {
  private readonly deps: Required<CalculationSchedulerDeps>;
  private state: CalculationSchedulerState = INITIAL_SCHEDULER_STATE;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempts = 0;
  private disposed = false;

  constructor(deps: CalculationSchedulerDeps) {
    this.deps = { maxRetryAttempts: DEFAULT_MAX_RETRY_ATTEMPTS, ...deps };
  }

  getState(): CalculationSchedulerState {
    return this.state;
  }

  /**
   * 指定年度の算定を実行する（保存・編集後の自動算定）。
   * すでに再試行待ちの年度は今回は呼ばず、予定済みの再試行に相乗りさせる（持ち越しとして結果に載せる）。
   * ユーザー操作のたびに呼ばれるため、自動再試行の回数はここでリセットする（操作が続く限り諦めない）。
   */
  run(fiscalYearIds: string[]): Promise<CalculationRunResult> {
    this.retryAttempts = 0;
    return this.enqueue(() => this.executeRun(fiscalYearIds, { joinPending: true }));
  }

  /**
   * 再試行待ちを取り消して、指定年度と待機中の年度をまとめて今すぐ実行する（手動の「今すぐ再計算」）。
   * 待機中の集合の取り出しと取り消しはキュー上のタスク内で行う（下記 fireRetry と同じ理由）。
   */
  runNow(fiscalYearIds: string[]): Promise<CalculationRunResult> {
    this.retryAttempts = 0;
    return this.enqueue(() => {
      const targets = [...new Set([...this.state.pendingFiscalYearIds, ...fiscalYearIds])];
      this.clearPending();
      return this.executeRun(targets, { joinPending: false });
    });
  }

  /** アンマウント時に呼ぶ。以後タイマーもコールバックも動かさない。 */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    // 失敗しても後続の実行を止めない（execute は throw しない設計だが念のため）。
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async executeRun(
    fiscalYearIds: string[],
    { joinPending }: { joinPending: boolean },
  ): Promise<CalculationRunResult> {
    const result = createEmptyRunResult();
    if (this.disposed) {
      return result;
    }
    this.setState({ ...this.state, isRunning: true });

    // 待機中の集合と予定時刻は対で読む。待機状態の書き換えはすべてキュー上のタスク内で行うため
    // ループ中に変わることは無いが、片方だけ生で読むと将来の変更で食い違いを招きやすい。
    const pending = new Set(this.state.pendingFiscalYearIds);
    const retryAt = this.state.retryAt;
    for (const fiscalYearId of fiscalYearIds) {
      if (joinPending && pending.has(fiscalYearId) && retryAt !== null) {
        result.deferredFiscalYearIds.push(fiscalYearId);
        result.retryAfterSeconds = Math.max(
          result.retryAfterSeconds ?? 0,
          Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)),
        );
        continue;
      }
      accumulateBatchResult(result, fiscalYearId, await this.deps.execute(fiscalYearId));
    }

    if (this.disposed) {
      return result;
    }
    // 相乗りした年度は既に待機中なので、新たに弾かれた年度だけを待機中の集合に足す。
    const newlyDeferred = result.deferredFiscalYearIds.filter((id) => !pending.has(id));
    if (newlyDeferred.length > 0 && result.retryAfterSeconds !== null) {
      this.scheduleRetry([...pending, ...newlyDeferred], result.retryAfterSeconds);
    }
    this.setState({ ...this.state, isRunning: false });
    return result;
  }

  private scheduleRetry(fiscalYearIds: string[], afterSeconds: number): void {
    this.clearTimer();
    const retryAt = Date.now() + afterSeconds * 1000;
    // 既存の予定より早める方向には動かさない（先に弾かれた年度の Retry-After を守る）。
    const effectiveRetryAt = Math.max(retryAt, this.state.retryAt ?? 0);
    this.timer = setTimeout(() => {
      void this.fireRetry();
    }, effectiveRetryAt - Date.now());
    this.setState({ ...this.state, pendingFiscalYearIds: fiscalYearIds, retryAt: effectiveRetryAt });
  }

  private async fireRetry(): Promise<void> {
    this.timer = null;
    if (this.disposed) {
      return;
    }
    this.retryAttempts += 1;

    // 待機中の集合の取り出し・実行・諦めの判定までをキュー上の 1 タスクで行う。
    // タイマーから直接 state を書き換えると、複数年度を処理中の run()（前の年度の execute を await 中）が
    // 読む待機中の集合と予定時刻が食い違い、相乗りさせるはずの年度を重ねて実行してしまう。
    const outcome = await this.enqueue(async () => {
      const targets = this.state.pendingFiscalYearIds;
      if (targets.length === 0) {
        // 先に並んでいた runNow が待機中の年度を取り出し済み。再試行として行うことは無い。
        return null;
      }
      this.setState({ ...this.state, pendingFiscalYearIds: [], retryAt: null });
      const result = await this.executeRun(targets, { joinPending: false });
      const gaveUp =
        result.deferredFiscalYearIds.length > 0 && this.retryAttempts >= this.deps.maxRetryAttempts;
      if (gaveUp) {
        // 連続して弾かれ続けている。待ち続けても解けない可能性があるため、持ち越しを捨てて手動導線へ誘導する。
        this.clearPending();
      }
      return { result, gaveUp };
    });

    if (this.disposed || outcome === null) {
      return;
    }
    if (outcome.result.deferredFiscalYearIds.length === 0) {
      this.retryAttempts = 0;
    }
    this.deps.onRetryFinished(outcome.result, outcome.gaveUp);
  }

  private clearPending(): void {
    this.clearTimer();
    this.setState({ ...this.state, pendingFiscalYearIds: [], retryAt: null });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setState(next: CalculationSchedulerState): void {
    this.state = next;
    if (!this.disposed) {
      this.deps.onStateChange(next);
    }
  }
}
