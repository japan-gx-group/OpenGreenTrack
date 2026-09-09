// データ入力画面の自動算定（/api/calculations 呼び出し）の純粋ロジック。
// UI（DataInput）から fetch の結果解釈とメッセージ組み立てを切り出し、単体テストできるようにする。
//
// /api/calculations は組織単位のレート制限（同時1件・1分あたりN件）を持ち、
// 保存のたびに呼ぶ自動算定が通常操作（連続入力・複数人での入力）で 429 に当たり得る。
// 429 は「保存済みだが未算定」の状態を黙って残さないよう、Retry-After を読み取って
// 自動再試行（calculationScheduler）へ渡す。

import { RATE_LIMIT_RETRY_AFTER_SECONDS } from '@/lib/security/apiRateLimit';
import { UNRESOLVED_REASON_MESSAGES, type UnresolvedReason } from '@/features/calculation/types';

/** Retry-After が読めない・異常なときの再試行秒数の上下限。 */
const MIN_RETRY_AFTER_SECONDS = 1;
const MAX_RETRY_AFTER_SECONDS = 300;

/** /api/calculations 1回分の結果。 */
export type CalculationBatchRequestResult =
  | {
      kind: 'completed';
      processedCount: number;
      totalEmissionsDelta: number;
      unresolvedReasons: UnresolvedReason[];
      /** 算定はできたが、明示選択した係数どおりには算定できなかった件数（読み替え・フォールバック） */
      factorWarningCount: number;
    }
  | { kind: 'rateLimited'; message: string; retryAfterSeconds: number }
  | { kind: 'failed'; message: string };

/** 複数年度分をまとめた 1 回の実行結果（自動再試行で持ち越した年度を含む）。 */
export interface CalculationRunResult {
  processedCount: number;
  totalEmissionsDelta: number;
  unresolvedCountByReason: Map<UnresolvedReason, number>;
  /** 算定はできたが、明示選択した係数どおりには算定できなかった件数 */
  factorWarningCount: number;
  failures: string[];
  /** レート制限（429）で持ち越し、自動再試行の対象になった年度。 */
  deferredFiscalYearIds: string[];
  /** 持ち越しがあるときの再試行までの秒数（目安）。持ち越しが無ければ null。 */
  retryAfterSeconds: number | null;
}

export const createEmptyRunResult = (): CalculationRunResult => ({
  processedCount: 0,
  totalEmissionsDelta: 0,
  unresolvedCountByReason: new Map(),
  factorWarningCount: 0,
  failures: [],
  deferredFiscalYearIds: [],
  retryAfterSeconds: null,
});

/**
 * Retry-After ヘッダ（秒）を再試行秒数へ変換する。
 * 欠落・非数値（プロキシで落とされた場合など）は 1 分制限の窓幅を既定値にし、異常値は上下限へ丸める。
 */
export const parseRetryAfterSeconds = (header: string | null): number => {
  const parsed = header === null ? Number.NaN : Number(header);
  const seconds = Number.isFinite(parsed) ? Math.ceil(parsed) : RATE_LIMIT_RETRY_AFTER_SECONDS;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(MIN_RETRY_AFTER_SECONDS, seconds));
};

/**
 * /api/calculations を 1 年度分呼び、応答を結果型へ変換する。
 * 429 は失敗ではなく「持ち越し」として扱い、Retry-After を返す。ネットワーク例外も throw せず failed にする。
 */
export const requestCalculationBatch = async (
  organizationId: string,
  fiscalYearId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CalculationBatchRequestResult> => {
  let response: Response;
  try {
    response = await fetchImpl('/api/calculations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId, fiscalYearId }),
    });
  } catch {
    return { kind: 'failed', message: '排出量の計算リクエストに失敗しました。' };
  }

  const summary = (await response.json().catch(() => ({}))) as {
    processedCount?: number;
    totalEmissionsDelta?: number;
    unresolved?: Array<{ reason?: UnresolvedReason }>;
    warnings?: unknown[];
    errorMessage?: string;
    error?: string;
  };

  if (response.status === 429) {
    return {
      kind: 'rateLimited',
      message: summary.error ?? '算定リクエストが混み合っています。',
      retryAfterSeconds: parseRetryAfterSeconds(response.headers.get('Retry-After')),
    };
  }
  if (!response.ok) {
    return {
      kind: 'failed',
      message: summary.error ?? summary.errorMessage ?? '排出量の計算に失敗しました。',
    };
  }

  return {
    kind: 'completed',
    processedCount: summary.processedCount ?? 0,
    totalEmissionsDelta: summary.totalEmissionsDelta ?? 0,
    // 理由が読めない（旧 API 応答など）場合は「係数なし」に寄せる。
    unresolvedReasons: (summary.unresolved ?? []).map((item) =>
      item.reason && item.reason in UNRESOLVED_REASON_MESSAGES ? item.reason : 'FACTOR_NOT_FOUND',
    ),
    factorWarningCount: Array.isArray(summary.warnings) ? summary.warnings.length : 0,
  };
};

/** 年度 1 件分の結果を実行結果へ積み上げる。 */
export const accumulateBatchResult = (
  run: CalculationRunResult,
  fiscalYearId: string,
  result: CalculationBatchRequestResult,
): void => {
  switch (result.kind) {
    case 'completed':
      run.processedCount += result.processedCount;
      run.totalEmissionsDelta += result.totalEmissionsDelta;
      for (const reason of result.unresolvedReasons) {
        run.unresolvedCountByReason.set(reason, (run.unresolvedCountByReason.get(reason) ?? 0) + 1);
      }
      run.factorWarningCount += result.factorWarningCount;
      return;
    case 'rateLimited':
      run.deferredFiscalYearIds.push(fiscalYearId);
      run.retryAfterSeconds = Math.max(run.retryAfterSeconds ?? 0, result.retryAfterSeconds);
      return;
    case 'failed':
      run.failures.push(result.message);
      return;
  }
};

export interface CalculationMessageOptions {
  /** どの算定年度にも属さず算定対象外だった件数。 */
  uncoveredCount: number;
  /**
   * 自動再試行の結果として呼ばれたか。true のときは「保存済みです」の文言を省き、
   * 処理対象が無かった場合（別の保存で先に算定済みなど）にも完了を知らせる。
   */
  isRetry?: boolean;
}

/**
 * 明示選択した係数どおりには算定できなかった件数の案内。
 * 事業者別係数が年度更新で入れ替わった場合は同じ事業者の当年度行へ読み替え、それも無ければ
 * 優先順位で自動選択した係数で算定している（docs/calculation-logic.md「明示指定」）。
 */
const FACTOR_WARNING_MESSAGE = (count: number): string =>
  `${count}件は選択した排出係数を適用できなかったため、別の係数で算定しました。入力履歴から該当レコードを開き、適用された係数をご確認ください。`;

/** 実行結果をトースト用の文言（改行で連結する前提の配列）に変換する。 */
export const buildCalculationMessages = (
  result: CalculationRunResult,
  { uncoveredCount, isRetry = false }: CalculationMessageOptions,
): string[] => {
  const messages: string[] = [];

  if (result.processedCount > 0) {
    messages.push(
      `排出量の自動計算が完了しました（${result.processedCount}件、合計 ${result.totalEmissionsDelta.toLocaleString(
        'ja-JP',
        { maximumFractionDigits: 3 },
      )} t-CO2e）。`,
    );
  }
  for (const [reason, count] of result.unresolvedCountByReason) {
    messages.push(`${count}件は${UNRESOLVED_REASON_MESSAGES[reason]}`);
  }
  if (result.factorWarningCount > 0) {
    // 選択した係数が使えず別の係数で算定した場合、値は出ているぶん気づきにくい。
    // 報告用途では算定根拠の差異を必ず知らせる必要があるため、成功時でも明示する。
    messages.push(FACTOR_WARNING_MESSAGE(result.factorWarningCount));
  }
  if (uncoveredCount > 0) {
    // 算定年度の登録は全メンバーが行える（ロール判定は無効）。
    messages.push(
      `${uncoveredCount}件は対象期間の算定年度が未登録のため、まだ排出量が計算されていません。\nデータは保存済みです。企業・メンバー設定 > 算定年度の管理で該当年度を登録してください。登録後は保存済みデータの排出量も計算できる状態になります（この画面を再読み込みすると最新の算定年度が反映されます）。`,
    );
  }
  if (result.failures.length > 0) {
    messages.push(`データは保存済みですが、排出量の自動計算に失敗しました: ${result.failures[0]}`);
  }
  if (result.deferredFiscalYearIds.length > 0) {
    const seconds = result.retryAfterSeconds ?? RATE_LIMIT_RETRY_AFTER_SECONDS;
    messages.push(
      `${isRetry ? '排出量の自動計算はまだ混み合っています' : 'データは保存済みですが、排出量の自動計算が混み合っています'}。約${seconds}秒後に自動で再試行します。この画面を開いたままお待ちください。`,
    );
  }
  if (isRetry && messages.length === 0) {
    // 再試行時に処理対象が無い（別の保存や他のメンバーの操作で先に算定済み）場合も、待機が終わったことを知らせる。
    messages.push('排出量の再計算が完了しました。');
  }
  return messages;
};

/** 自動再試行の上限に達して諦めたときの案内。手動の再計算導線へ誘導する。 */
export const RETRY_GAVE_UP_MESSAGE =
  '排出量の自動計算の再試行が上限に達しました。データは保存済みです。入力履歴の「未算定分を再計算」から再度お試しください。';
