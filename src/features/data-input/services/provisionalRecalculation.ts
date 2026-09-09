// データ入力画面から呼ぶ「暫定適用の再算定」導線（/api/calculations/provisional-recalculation）の
// 純粋ロジック。fetch の結果解釈とメッセージ組み立てを UI（DataInput）から切り出し、単体テストできるようにする。
//
// 未公表年度の暫定適用で算定した結果は、正式係数を投入しても算定バッチ（isCalculated = false の
// レコードだけを処理する）では置き換わらない。GET で対象年度と件数を取り、POST で該当レコードを
// 再算定対象へ戻したうえで、既存の /api/calculations（レート制限つき・自動再試行あり）で算定し直す。

/** 再算定が必要な年度と件数（API 応答の 1 件分）。 */
export interface ProvisionalRecalculationTarget {
  fiscalYearId: string;
  fiscalYearLabel: string;
  recordCount: number;
}

/**
 * 再算定が必要な年度の一覧を取得する。
 * 画面表示のたびに呼ぶ補助情報なので、失敗しても throw せず空配列を返す（バナーを出さないだけ）。
 */
export const fetchProvisionalRecalculationTargets = async (
  fetchImpl: typeof fetch = fetch,
): Promise<ProvisionalRecalculationTarget[]> => {
  let response: Response;
  try {
    response = await fetchImpl('/api/calculations/provisional-recalculation');
  } catch {
    return [];
  }
  if (!response.ok) {
    return [];
  }

  const body = (await response.json().catch(() => ({}))) as {
    targets?: unknown;
  };
  if (!Array.isArray(body.targets)) {
    return [];
  }

  return body.targets.flatMap((item) => {
    const target = item as Partial<ProvisionalRecalculationTarget>;
    return typeof target.fiscalYearId === 'string' &&
      typeof target.fiscalYearLabel === 'string' &&
      typeof target.recordCount === 'number'
      ? [
          {
            fiscalYearId: target.fiscalYearId,
            fiscalYearLabel: target.fiscalYearLabel,
            recordCount: target.recordCount,
          },
        ]
      : [];
  });
};

/** 差し戻し（isCalculated = false へ戻す）1 年度分の結果。 */
export type ProvisionalResetResult =
  | { kind: 'reset'; resetCount: number }
  | { kind: 'failed'; message: string };

/**
 * 指定年度の暫定適用レコードを再算定対象へ戻す。
 * 呼び出し側は、成功した年度について続けて算定（/api/calculations）を実行すること。
 * 差し戻しだけで終わるとその分の排出量が未算定のまま残る。
 */
export const requestProvisionalReset = async (
  fiscalYearId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProvisionalResetResult> => {
  let response: Response;
  try {
    response = await fetchImpl('/api/calculations/provisional-recalculation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fiscalYearId }),
    });
  } catch {
    return { kind: 'failed', message: '再算定リクエストに失敗しました。' };
  }

  const body = (await response.json().catch(() => ({}))) as {
    resetCount?: number;
    error?: string;
  };
  if (!response.ok) {
    return { kind: 'failed', message: body.error ?? '再算定の準備に失敗しました。' };
  }
  return { kind: 'reset', resetCount: body.resetCount ?? 0 };
};

/** バナーの本文。対象年度が複数のときは年度ラベルを並べる。 */
export const buildProvisionalRecalculationNotice = (
  targets: ProvisionalRecalculationTarget[],
): string => {
  const totalCount = targets.reduce((total, target) => total + target.recordCount, 0);
  const labels = targets.map((target) => target.fiscalYearLabel).join('・');
  return `正式な排出係数が公表される前に暫定適用で算定したデータが ${labels} に ${totalCount} 件あります。いまは正式な係数を適用できるため、再算定するまでダッシュボード・レポートには古い係数の排出量が残ります。`;
};

/** 差し戻し結果（年度ごと）をトースト用の文言に変換する。算定側の文言は buildCalculationMessages が担う。 */
export const buildProvisionalResetMessages = (results: ProvisionalResetResult[]): string[] => {
  const resetCount = results.reduce(
    (total, result) => (result.kind === 'reset' ? total + result.resetCount : total),
    0,
  );
  const failures = results.flatMap((result) => (result.kind === 'failed' ? [result.message] : []));

  const messages: string[] = [];
  if (resetCount > 0) {
    messages.push(`暫定適用で算定していた ${resetCount} 件を正式な排出係数で再算定します。`);
  }
  if (resetCount === 0 && failures.length === 0) {
    // 別の操作で先に再算定された場合。バナーは再取得で消えるため、結果だけ伝える。
    messages.push('再算定が必要なデータはありませんでした。');
  }
  messages.push(...failures);
  return messages;
};
