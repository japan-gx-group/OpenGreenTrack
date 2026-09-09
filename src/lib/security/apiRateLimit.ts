// 認証済みの重いAPIに共通する、DBカウント型レート制限の閾値と判定ロジック。
// 追加ライブラリを使わず、Supabase のRPC内で直近・未完了件数を数えて適用する。

// 「1分あたりN件」の窓。この制限は時間で必ず解けるため、Retry-After は窓幅そのものでよい。
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const RATE_LIMIT_RETRY_AFTER_SECONDS = RATE_LIMIT_WINDOW_MS / 1000;

// 滞留した pending が組織全体の算定を恒久ブロックしないよう、稼働中とみなす範囲を区切る。
// この窓から外れた pending は、プロセスが落ちて failed を書けなかった行とみなし、
// 次のバッチ作成時に RPC（create_calculation_batch_with_rate_limit）が failed へ倒す。
// 実行中の行を数える側の制限は「時間」ではなく「先行バッチの完了」で解けるため、
// Retry-After には窓幅ではなく処理の実時間の目安を返す（窓幅を返すと、待っても解けない値になる）。
export const CALCULATION_PENDING_WINDOW_MS = 10 * 60 * 1000;
export const CALCULATION_CONCURRENT_LIMIT = 1;
// 算定は保存・編集のたびに自動で走るため、当初の 3 件/分では連続入力や複数人での入力という
// 通常操作で 4 件目から弾かれていた。同時実行は上の「稼働中 1 件」が既に抑えているので、
// 1 分あたりの上限は暴走（スクリプトによる連打）を止める番人に留め、通常操作では当たらない値にする。
// 目安: 1 件の保存→算定が数秒、2 人が並行して 1 分に 4〜5 件ずつ保存しても収まる。
export const CALCULATION_PER_MINUTE_LIMIT = 10;
// 算定バッチは通常数秒〜数十秒で完了するため、短めの再試行目安を返す。
export const CALCULATION_PENDING_RETRY_AFTER_SECONDS = 30;

export const HEAVY_API_SQLSTATE = {
  calculationPending: 'P2023',
  calculationRecent: 'P2024',
  calculationFiscalYearInvalid: 'P2026',
  // run_calculation_commit: バッチが pending でない（滞留として回収済み・完了済み）ため確定を中止した
  calculationBatchNotPending: 'P2028',
} as const;

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

interface DbErrorLike {
  code?: string;
}

export const getCalculationRateLimitError = (
  error: DbErrorLike,
): RateLimitExceededError | null => {
  if (error.code === HEAVY_API_SQLSTATE.calculationPending) {
    return new RateLimitExceededError(
      '算定処理がすでに実行中です。完了後に再度お試しください。',
      CALCULATION_PENDING_RETRY_AFTER_SECONDS,
    );
  }
  if (error.code === HEAVY_API_SQLSTATE.calculationRecent) {
    return new RateLimitExceededError(
      `算定リクエストは1分あたり${CALCULATION_PER_MINUTE_LIMIT}件までです。少し待ってから再度お試しください。`,
      RATE_LIMIT_RETRY_AFTER_SECONDS,
    );
  }
  // 同じ年度の pending 1 件制約（calculation_batches_one_pending_per_year）。窓内の pending は P2023 が先に拾い、
  // 窓外の pending は RPC が failed へ倒すため通常は到達しないが、到達しても「待てば解ける」文言にしておく
  // （「完了までお待ちください」は、前回が完了しないまま止まった場合に恒久ブロックを示唆してしまう）。
  if (error.code === '23505') {
    return new RateLimitExceededError(
      'この算定年度の前回の算定が完了していません。時間をおいて再度お試しください。',
      CALCULATION_PENDING_RETRY_AFTER_SECONDS,
    );
  }
  return null;
};

export const getCalculationRequestError = (
  error: DbErrorLike,
): ApiRequestError | null => {
  if (error.code === HEAVY_API_SQLSTATE.calculationFiscalYearInvalid) {
    return new ApiRequestError('算定年度が見つかりません', 400);
  }
  return null;
};
