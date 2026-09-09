// データ入力フォームで「この入力がダッシュボードの Scope 3 合計に採用されるか」を判定するサービス。
//
// 背景: Scope 3 は 15 カテゴリそれぞれで算定方法（scope3_category_methods.method）を
// 排他選択し、refresh_dashboard_aggregates は
//   - calculated → emission_results（scope='scope3' の積上げ算定）の合計
//   - direct（行が無いカテゴリの既定）→ scope3_category_emissions の直接入力値
// だけを scope3Total に採用する。廃棄物・出張・通勤の標準係数入力も IDEA 積上げ入力も
// emission_results 側に載るため、方式が direct のままだと算定は成功するのに
// ダッシュボードの Scope 3 は 1g も増えない。入力の時点でこれを知らせるための判定をここに置く。
//
// 方式の自動切替は行わない（direct の入力値と二重管理になり、既存の直接入力値を黙って
// 未採用にしてしまうため）。注記で Scope分析画面の切替へ誘導する。

import { scope3CategoryIdForEnergyType } from '@/features/calculation/engine/scope3Category';
import { createClient } from '@/lib/supabase/client';
import {
  SCOPE3_CATEGORY_NAMES,
  type Scope3Method,
} from '@/features/scope-analysis/services/scopeAnalysisService';
import type { EntryCategory } from './entryCategory';

/**
 * この入力が積上げ（calculated）側に載る Scope 3 カテゴリ番号。載らないなら null。
 * 判定は算定エンジン（computeEmissions の categoryId 付与）と同じ:
 *   - IDEA 積上げ（kind='scope3'）: 選択したカテゴリそのもの
 *   - 排出係数マスタ経路（kind='energy'）: 適用される係数の scope が 'scope3' のときだけ
 *     energyType から引くカテゴリ（廃棄物5・出張6・通勤7 など）
 * 係数が未確定（読込中・候補なし）の間は null＝判定しない。
 */
export const scope3AdoptedCategoryId = (params: {
  category: EntryCategory;
  /** 保存後に適用される係数の scope（'scope1' | 'scope2' | 'scope3'）。未確定なら null */
  appliedFactorScope: string | null;
}): number | null => {
  const { category, appliedFactorScope } = params;
  if (category.kind === 'scope3') {
    return category.categoryId;
  }
  return appliedFactorScope === 'scope3' ? scope3CategoryIdForEnergyType(category.energyType) : null;
};

/**
 * 方式が direct のカテゴリに積上げ入力をしようとしているときの注記本文。採用される場合は null。
 * 導線（Scope分析画面へのリンク）は呼び出し側の UI が添える。
 *
 * 方式はカテゴリ×会計年度ごとに持つため、注記にはどの年度の方式かを必ず書く。
 * 対象年月が画面上部で選択中の年度と違う（過年度の一括入力など）とき、年度を書かないと
 * 利用者は別年度のカテゴリを切替えてしまい「切替えたのに反映されない」ように見えるため。
 */
export const scope3DirectMethodNoticeText = (params: {
  categoryId: number | null;
  method: Scope3Method | null;
  /** この入力の対象年月が属する会計年度のラベル（例: '2025年度'）。特定できないときは null */
  fiscalYearLabel?: string | null;
}): string | null => {
  const { categoryId, method, fiscalYearLabel = null } = params;
  if (categoryId === null || method !== 'direct') {
    return null;
  }
  const name = SCOPE3_CATEGORY_NAMES[categoryId] ?? '';
  return (
    `この入力は${fiscalYearLabel ? `${fiscalYearLabel}の` : ''} Scope 3 カテゴリ${categoryId}「${name}」の` +
    `積上げ算定として保存されますが、${fiscalYearLabel ? 'この年度の' : ''}このカテゴリの算定方法は` +
    `「直接入力」のため、ダッシュボードの Scope 3 合計には反映されません。` +
    `反映するには Scope分析画面で${fiscalYearLabel ? `${fiscalYearLabel}の` : ''}カテゴリ${categoryId} を` +
    `「積上げに切替」してください。`
  );
};

/** useKeyedLoader 用のキー。'<会計年度ID>:<カテゴリ番号>' */
export type Scope3MethodKey = `${string}:${number}`;

export const scope3MethodKey = (fiscalYearId: string, categoryId: number): Scope3MethodKey =>
  `${fiscalYearId}:${categoryId}`;

/**
 * カテゴリ×年度の算定方法を取得する（行が無ければ 'direct'＝既定）。
 * RLS により自組織の行しか返らないため、組織IDでの絞り込みは不要。
 */
export const getScope3CategoryMethod = async (key: Scope3MethodKey): Promise<Scope3Method> => {
  const separator = key.lastIndexOf(':');
  const fiscalYearId = key.slice(0, separator);
  const categoryId = Number(key.slice(separator + 1));

  const supabase = createClient();
  const { data, error } = await supabase
    .from('scope3_category_methods')
    .select('method')
    .eq('fiscalYearId', fiscalYearId)
    .eq('categoryId', categoryId)
    .maybeSingle();

  if (error) {
    throw new Error('Scope 3 の算定方法の取得に失敗しました');
  }
  return (data as { method: Scope3Method } | null)?.method ?? 'direct';
};
