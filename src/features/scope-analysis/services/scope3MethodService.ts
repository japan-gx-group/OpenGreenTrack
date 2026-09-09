// Scope3 カテゴリの算定方法切替と direct 方式の値（scope3_category_emissions）の
// 保存サービス（docs/idea-scope3-spec.md §5.1・§5.2）。
// 書き込みは RLS（自組織スコープ）前提でブラウザから直接 upsert し、直後に
// /api/dashboard-aggregates/refresh（認証＋自組織検証つき Route Handler）で
// refresh_dashboard_aggregates を実行して scope3Total を即時更新する（バッチ再実行不要）。

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { Scope3Method } from './scopeAnalysisService';

const getCurrentOrganizationId = async (supabase: SupabaseClient): Promise<string> => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('ログイン情報が確認できませんでした。再度ログインしてください');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('organizationId')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    throw new Error('所属組織を特定できませんでした');
  }
  return (data as { organizationId: string }).organizationId;
};

/**
 * ダッシュボード集計（scope1/2/3Total）を再計算する。
 * refresh_dashboard_aggregates は service_role 限定のため Route Handler 経由で呼ぶ。
 */
export const refreshDashboardAggregates = async (fiscalYearId: string): Promise<void> => {
  const response = await fetch('/api/dashboard-aggregates/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fiscalYearId }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'ダッシュボード集計の更新に失敗しました');
  }
};

/**
 * カテゴリの算定方法を切り替える（scope3_category_methods を upsert → 集計を即時更新）。
 * 'calculated' へ切り替えても直接入力値は削除しない（「未採用」表示で保持。切替の可逆性）。
 */
export const saveScope3CategoryMethod = async (
  fiscalYearId: string,
  categoryId: number,
  method: Scope3Method,
): Promise<void> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { error } = await supabase.from('scope3_category_methods').upsert(
    { organizationId, fiscalYearId, categoryId, method },
    { onConflict: 'organizationId,fiscalYearId,categoryId' },
  );
  if (error) {
    throw new Error('算定方法の切替に失敗しました');
  }

  await refreshDashboardAggregates(fiscalYearId);
};

/**
 * direct 方式の値（カテゴリ別排出量）を登録・更新する
 * （scope3_category_emissions を upsert → 集計を即時更新）。
 * 'calculated' 採用中のカテゴリにも保存できる（値は保持され「未採用」表示になる）。
 */
export const saveScope3DirectEmissions = async (
  fiscalYearId: string,
  categoryId: number,
  emissions: number,
  dataSourceNote?: string | null,
): Promise<void> => {
  if (!Number.isFinite(emissions) || emissions < 0) {
    throw new Error('排出量には0以上の数値を入力してください');
  }

  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { error } = await supabase.from('scope3_category_emissions').upsert(
    {
      organizationId,
      fiscalYearId,
      categoryId,
      emissions,
      dataSourceNote: dataSourceNote?.trim() ? dataSourceNote.trim() : null,
    },
    { onConflict: 'organizationId,fiscalYearId,categoryId' },
  );
  if (error) {
    throw new Error('Scope 3カテゴリ別排出量の保存に失敗しました');
  }

  await refreshDashboardAggregates(fiscalYearId);
};
