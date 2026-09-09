// IDEA 製品検索（docs/idea-scope3-spec.md §4.2）。
// active なインポートの係数だけを対象に、サーバーサイド ilike のインクリメンタル検索を行う。
// 約1万行 × 組織のデータを全行クライアントへロードしない（上限50件）。
// SearchableSelect と組み合わせる想定のサービス関数（データ入力画面で使用）。

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { SearchableSelectOption } from '@/components/ui/searchableSelectFilter';

/** 検索結果の上限件数（§4.2） */
export const IDEA_PRODUCT_SEARCH_LIMIT = 50;

export interface IdeaProduct {
  /** idea_factors.id（activity_records.ideaFactorId へ紐づける値） */
  id: string;
  ideaCode: string;
  productName: string;
  country: string;
  unit: string;
}

/**
 * ilike パターンのメタ文字を無効化する（純関数）。
 * ユーザー入力の '%' '_' '\' がワイルドカードとして解釈されると
 * 意図しない全件マッチになるためエスケープする。
 */
export const escapeIlikePattern = (input: string): string =>
  input.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');

/**
 * PostgREST の or= 論理ツリーで安全に使えるよう値をダブルクォートで包む（純関数）。
 * or 構文では ',' '(' ')' が条件の区切りとして解釈されるため、ユーザー入力を
 * そのまま埋め込むとフィルタ文字列が壊れる。クォート内の '\' と '"' は
 * バックスラッシュでエスケープする（PostgREST の quoted string 仕様）。
 */
export const quoteOrFilterValue = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/**
 * 検索結果を SearchableSelect の候補形式へ変換する（純関数）。
 * 検索は製品名・IDEA製品コードのどちらでも当たるよう searchText に両方を入れる。
 */
export const toIdeaProductOptions = (products: readonly IdeaProduct[]): SearchableSelectOption[] =>
  products.map((product) => ({
    value: product.id,
    label: `${product.productName}（${product.country} / ${product.unit}）`,
    searchText: `${product.ideaCode} ${product.productName}`,
  }));

interface IdeaFactorSearchRow {
  id: string;
  ideaCode: string;
  productName: string;
  country: string;
  unit: string;
}

/**
 * 製品選択後のインライン概算・保存に必要な idea_factors の全カラム。
 * IdeaFactorRow（features/calculation/types.ts）を構造的に満たすため、
 * そのまま normalizeIdeaFactor へ渡して算定バッチと同一ロジックで概算できる。
 */
export interface IdeaProductDetail extends IdeaProduct {
  organizationId: string;
  importId: string;
  baseFlowAmount: number | string;
  gwpValue: number | string;
  /** 取込記録の版表記（例 'Ver.4.0 標準版'）。概算表示の出典表記に使う。取れなければ null */
  importVersion: string | null;
}

interface IdeaFactorDetailRow extends IdeaFactorSearchRow {
  organizationId: string;
  importId: string;
  baseFlowAmount: number | string;
  gwpValue: number | string;
  idea_imports: { version: string } | { version: string }[] | null;
}

/**
 * IDEA 製品の詳細（係数値を含む）を1件取得する。組織スコープは RLS が担保する。
 * 参照切れ（係数が版削除された等）の場合は null を返す。
 */
export const getIdeaProductDetail = async (
  id: string,
  options: { client?: SupabaseClient } = {},
): Promise<IdeaProductDetail | null> => {
  const supabase = options.client ?? createClient();
  const { data, error } = await supabase
    .from('idea_factors')
    .select(
      'id, organizationId, importId, ideaCode, productName, country, unit, baseFlowAmount, gwpValue, idea_imports(version)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error('IDEA製品情報の取得に失敗しました');
  }
  if (!data) {
    return null;
  }

  const row = data as unknown as IdeaFactorDetailRow;
  const importMeta = Array.isArray(row.idea_imports) ? row.idea_imports[0] ?? null : row.idea_imports;

  return {
    id: row.id,
    organizationId: row.organizationId,
    importId: row.importId,
    ideaCode: row.ideaCode,
    productName: row.productName,
    country: row.country,
    unit: row.unit,
    baseFlowAmount: row.baseFlowAmount,
    gwpValue: row.gwpValue,
    importVersion: importMeta?.version ?? null,
  };
};

/**
 * IDEA 製品を検索する。組織スコープは RLS（idea_factors の自組織 SELECT ポリシー）が担保する。
 *
 * §4.2: 検索対象は active インポートのみ。country=JPN を優先表示し、
 * 上限に満たない分を JPN 以外（GLO 等）で補完する。
 *
 * @param query 検索キーワード（製品名または IDEA 製品コードの部分一致。空文字は先頭からの一覧）
 * @param options.limit 取得上限（既定 50）
 * @param options.client テスト差し替え用の Supabase クライアント
 */
export const searchIdeaProducts = async (
  query: string,
  options: { limit?: number; client?: SupabaseClient } = {},
): Promise<IdeaProduct[]> => {
  const limit = options.limit ?? IDEA_PRODUCT_SEARCH_LIMIT;
  const supabase = options.client ?? createClient();
  const trimmed = query.trim();
  const pattern = `%${escapeIlikePattern(trimmed)}%`;

  const fetchByCountry = async (countryScope: 'jpn' | 'other', scopeLimit: number) => {
    let builder = supabase
      .from('idea_factors')
      // !inner 結合 + isActive フィルタで「active インポートの係数のみ」に絞る（§4.2）
      .select('id, ideaCode, productName, country, unit, idea_imports!inner(isActive)')
      .eq('idea_imports.isActive', true);
    builder =
      countryScope === 'jpn' ? builder.eq('country', 'JPN') : builder.neq('country', 'JPN');
    if (trimmed !== '') {
      // 製品名・IDEA製品コードのどちらでも当たるようにする（データ入力画面の
      // 「製品名またはIDEA製品コードで検索」表記と対応）。disableClientFilter の
      // SearchableSelect ではクライアント側の searchText 絞り込みが行われないため、
      // コード検索はこのサーバーサイド OR 条件が唯一の経路になる。
      const quoted = quoteOrFilterValue(pattern);
      builder = builder.or(`productName.ilike.${quoted},ideaCode.ilike.${quoted}`);
    }
    const { data, error } = await builder
      .order('productName', { ascending: true })
      .order('ideaCode', { ascending: true })
      .limit(scopeLimit);
    if (error) {
      throw new Error('IDEA製品の検索に失敗しました');
    }
    return (data ?? []) as unknown as IdeaFactorSearchRow[];
  };

  // JPN を優先し、残枠を JPN 以外（GLO 等）で埋める。
  const jpnRows = await fetchByCountry('jpn', limit);
  const remaining = limit - jpnRows.length;
  const otherRows = remaining > 0 ? await fetchByCountry('other', remaining) : [];

  return [...jpnRows, ...otherRows].map((row) => ({
    id: row.id,
    ideaCode: row.ideaCode,
    productName: row.productName,
    country: row.country,
    unit: row.unit,
  }));
};
