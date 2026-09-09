import type { EmissionFactor } from '../services/factorService';

/** 更新履歴モーダルが一度に描画する行数。超過分は「さらに表示」で段階的に追加する。 */
export const FACTOR_HISTORY_PAGE_SIZE = 100;

/** 画面下部の「更新履歴」カードに出す件数。 */
export const FACTOR_HISTORY_PREVIEW_COUNT = 3;

const toTime = (value?: string): number => (value ? new Date(value).getTime() : 0);

/**
 * 更新履歴に載せる係数を新しい順に返す。
 *
 * 対象はカスタム係数（ユーザーが追加・変更したもの）のみ。公式係数は seed で全件同一トランザクションの
 * now() が updatedAt に入るため、updatedAt 順に並べても「約5,900件が同着」になり履歴として意味を持たない。
 * 公式係数の改訂履歴が必要になった時点で監査ログと合わせて再設計する。
 */
export const selectFactorHistory = (factors: readonly EmissionFactor[]): EmissionFactor[] =>
  factors
    .filter((item) => item.isCustom && item.updatedAt)
    .sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt));
