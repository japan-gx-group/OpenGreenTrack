// データ入力画面のインライン計算用に、係数候補を取得するサービス（I/O）。
// ブラウザ（Client Component）から呼ぶ。読み取りは RLS で自組織＋標準係数に制限される。
// 取得した係数は算定エンジンの EmissionFactorRow と同じ形に正規化し、
// 純関数（inlineCalculation.ts / resolveEmissionFactor）へそのまま渡せるようにする。

import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabaseRows';
import type { EmissionFactorRow } from '@/features/calculation/types';
import { withProvisionalYears } from '@/features/calculation/engine/resolveEmissionFactor';

/** 画面表示用に出典情報（source / sourceDocumentName）も持つ係数候補行。 */
export type CandidateFactorRow = EmissionFactorRow & {
  /** 発行元（DB enum: moe / meti / ketsoho / utility / custom） */
  source: string;
  /** 出典となる公表資料名（標準係数のみ設定される） */
  sourceDocumentName: string | null;
};

// 発行元 enum → 画面表示ラベル（factorService と同じ対応。「出典」表示に使う）。
export const FACTOR_SOURCE_LABELS: Record<string, string> = {
  moe: '環境省',
  meti: '経済産業省',
  ketsoho: '温対法',
  utility: '事業者別排出係数',
  custom: '自社設定',
};

/** supabase-js が numeric を文字列で返す場合に備えて number へ正規化する */
const toNumber = (value: unknown): number => Number(value);

const CANDIDATE_SELECT =
  'id,organizationId,name,energyType,scope,factorValue,unit,applicableYear,regionName,status,isCustom,locationId,supplierId,effectiveFrom,effectiveTo,providerName,providerNumber,menuName,factorType,source,sourceDocumentName';

/**
 * 対象の適用年度群に対する有効な標準・カスタム係数を取得する。
 * 算定バッチ（calculationService）と同じ絞り込み条件（status='active'・applicableYear 一致）を使い、
 * プレビューで表示した係数と実際の算定で使う係数がずれないようにする。
 * scope では絞らない: 廃棄物・輸送・出張・通勤などは seed の scope3 標準係数で算定するため、
 * scope1/2 に限定するとこれらのカテゴリで候補が空になる（算定バッチも scope で絞らない）。
 * 適用年度群は applicableYearsForRecord（会計年度の開始年＋対象月の温対法年度）に
 * withProvisionalYears でフォールバック年度を足したものを渡す（対象年度の公式係数が未公表の間は
 * 直近の過年度を暫定適用するため。どの年度を実際に使うかの判定は純粋コアに委ねる）。
 * 事業者別係数（providerName あり）は自動解決の対象外かつ数千行あるため除外する
 * （事業者選択UI用には getProviderFactors を使う）。
 * 年度あたりの標準係数が max_rows（1000）を超えると、サーバ側の算定（calculationService は
 * fetchAllRows 済み）は正しく解決するのにインライン候補・自動選択のプレビューだけが静かに欠けて
 * 「プレビューと算定結果の不一致」になるため、こちらも fetchAllRows でページングして全行取得する。
 */
export const getActiveScope12Factors = async (
  applicableYears: number[],
): Promise<CandidateFactorRow[]> => {
  if (applicableYears.length === 0) {
    return [];
  }

  const supabase = createClient();
  const rows = await fetchAllRows<CandidateFactorRow>(
    (from, to) =>
      supabase
        .from('emission_factors')
        .select(CANDIDATE_SELECT)
        .eq('status', 'active')
        .in('applicableYear', applicableYears)
        .is('providerName', null)
        // 表示順の保証ではなく、ページ境界で行が重複・欠落しないよう並び順を固定するための id ソート。
        .order('id', { ascending: true })
        .range(from, to),
    '排出係数の取得に失敗しました',
  );

  return rows.map((row) => ({
    ...row,
    factorValue: toNumber(row.factorValue),
  }));
};

/**
 * 供給事業者別係数（電気・都市ガス・熱）を取得する。
 * 手動入力の「計算方法（基礎/調整後）→ 供給事業者 → メニュー」選択UI用。
 * applicableYear は対象月の温対法年度（deriveApplicableYear）を渡す: 事業者別係数は公式係数で
 * 4月〜翌3月の有効期間を持つため、非4月始まりの組織でも会計年度の開始年ではなく温対法年度で引く。
 * 電気は事業者×メニュー×係数種別で PostgREST の max_rows(1000) を超えるため、
 * fetchAllRows でページングして全行取得する。
 */
export const getProviderFactors = async (
  energyType: string,
  applicableYear: number,
): Promise<CandidateFactorRow[]> => {
  const supabase = createClient();
  const rows = await fetchAllRows<CandidateFactorRow>(
    (from, to) =>
      supabase
        .from('emission_factors')
        .select(CANDIDATE_SELECT)
        .eq('status', 'active')
        .eq('energyType', energyType)
        // 対象年度が未公表の間は直近の過年度の事業者別係数を暫定適用するため、
        // 単年ではなくフォールバック年度も含めて取得する。対象年度が公表済みのときに
        // 過年度の行を落とす判定は純粋コアに委ねる（listApplicableProviderFactors）。
        .in('applicableYear', withProvisionalYears([applicableYear]))
        .not('providerName', 'is', null)
        .order('providerNumber', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    '供給事業者別係数の取得に失敗しました',
  );

  return rows.map((row) => ({
    ...row,
    factorValue: toNumber(row.factorValue),
  }));
};
