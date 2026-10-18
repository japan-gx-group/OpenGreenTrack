// 係数管理画面から呼ぶ「カスタム係数の値を変えたときの再算定」導線のクライアントサービス。
//
// 係数の編集は行の上書きで、算定済みの結果は算定時の値のまま残る（算定バッチは未算定レコードしか処理しない）。
// 値・単位を変えて保存するとき、その係数で算定済みのデータ件数を示し、利用者が再算定を選んだら
// 該当レコードを再算定対象へ戻す（/api/calculations/factor-recalculation）。続く算定は呼び出し側が
// 既存の /api/calculations で行う（データ入力画面の暫定適用の再算定と同じ流れ）。

import { createClient } from '@/lib/supabase/client';
import type { EmissionFactor } from './factorService';

/**
 * 算定に効く項目（係数値・単位）が変わったか。名称や出典だけの変更では算定結果は変わらないため、
 * 再算定の確認は出さない。
 */
export const hasCalculationInputChanged = (
  before: Pick<EmissionFactor, 'factorValue' | 'unit'>,
  after: Pick<EmissionFactor, 'factorValue' | 'unit'>,
): boolean => before.factorValue !== after.factorValue || before.unit !== after.unit;

/**
 * この係数で算定済みのデータ件数。emission_results.emissionFactorId は算定時に実際に適用した係数で、
 * 明示選択・自動解決の別を問わない。RLS（自組織のみ）に任せてブラウザから数える。
 */
export const countCalculatedRecordsForFactor = async (factorId: string): Promise<number> => {
  const supabase = createClient();
  const { count, error } = await supabase
    .from('emission_results')
    .select('id', { count: 'exact', head: true })
    .eq('emissionFactorId', factorId);
  if (error) {
    throw new Error('この係数で算定済みのデータの確認に失敗しました');
  }
  return count ?? 0;
};

export type FactorRecalculationResetResult =
  | { kind: 'reset'; resetCount: number; skippedCount: number; fiscalYearIds: string[] }
  | { kind: 'failed'; message: string };

/**
 * この係数で算定済みのレコードを再算定対象へ戻す。
 * 呼び出し側は、戻せた年度（fiscalYearIds）について続けて算定（/api/calculations）を実行すること。
 * 差し戻しだけで終わるとその分の排出量が未算定のまま残る。
 */
export const requestFactorRecalculationReset = async (
  factorId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FactorRecalculationResetResult> => {
  let response: Response;
  try {
    response = await fetchImpl('/api/calculations/factor-recalculation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ factorId }),
    });
  } catch {
    return { kind: 'failed', message: '再算定リクエストに失敗しました。' };
  }

  const body = (await response.json().catch(() => ({}))) as {
    resetCount?: number;
    skippedCount?: number;
    fiscalYearIds?: string[];
    error?: string;
  };
  if (!response.ok) {
    return { kind: 'failed', message: body.error ?? '再算定の準備に失敗しました。' };
  }
  return {
    kind: 'reset',
    resetCount: body.resetCount ?? 0,
    skippedCount: body.skippedCount ?? 0,
    fiscalYearIds: Array.isArray(body.fiscalYearIds) ? body.fiscalYearIds : [],
  };
};

/** 差し戻し結果をトースト用の文言に変換する。算定側の文言は buildCalculationMessages が担う。 */
export const buildFactorResetMessages = (
  factorName: string,
  result: FactorRecalculationResetResult,
): string[] => {
  if (result.kind === 'failed') {
    return [`「${factorName}」は更新しましたが、再算定を開始できませんでした: ${result.message}`];
  }
  const messages: string[] = [];
  if (result.resetCount > 0) {
    messages.push(`「${factorName}」の変更後の値で ${result.resetCount} 件を再算定します。`);
  }
  if (result.skippedCount > 0) {
    messages.push(
      `${result.skippedCount} 件は対象期間の算定年度が登録されていないため、変更前の値の算定結果のまま残しました。`,
    );
  }
  if (result.resetCount === 0 && result.skippedCount === 0) {
    // 確認してから保存するまでの間に、別の操作で再算定・削除された場合。
    messages.push(`「${factorName}」で算定済みのデータはありませんでした。`);
  }
  return messages;
};
