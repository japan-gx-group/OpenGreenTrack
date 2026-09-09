// 暫定適用のまま残った算定済みレコードの検出と、再算定対象への差し戻し（I/O）。
//
// 背景:
//   対象年度の公式係数が未公表の間、算定は直近の過年度の係数を暫定適用する
//   （docs/calculation-logic.md「未公表年度の暫定適用」）。その後 seed で正式係数を投入すると
//   入力フォームの「暫定適用」表示は消えるが、**算定済みの結果は古い係数のまま残る**。
//   算定バッチ（calculationService）が isCalculated = false のレコードしか処理しないためで、
//   放置するとダッシュボード・レポートに旧年度係数ベースの排出量が混ざったままになる。
//
//   ここで「暫定適用で算定され、いまは正式係数が使えるようになったレコード」を洗い出し、
//   isCalculated = false へ戻す。旧 emission_results は DB トリガー
//   （clear_emission_results_on_recalculation）が同一トランザクションで消すため、
//   差し戻した時点で二重計上は起きない。差し戻し後の算定は既存の /api/calculations
//   （レート制限つき・未算定レコードをまとめて処理）に任せる。
//   ⚠️ 差し戻しから算定までの間、そのレコードの排出量は dashboard_aggregates に残った
//   古い値のまま（集計の再計算は run_calculation_commit が行う）。呼び出し側は差し戻しに
//   続けて必ず算定を実行すること。実行できなかった場合もレコードは「未算定」として
//   データ入力画面・レポートの「データ充足状況」に出るため、黙って消えることはない。
//
// ⚠️ サーバ専用: service_role の管理クライアント（src/lib/supabase/admin.ts）を使う。
// Client Component から import しないこと（AGENTS.md R7）。呼び出し元の Route Handler で
// 「ログイン済み・自組織のみ」を検証する。

import { createAdminClient } from '@/lib/supabase/admin';
import { IN_CHUNK_SIZE, chunk, fetchAllRows } from '@/lib/supabaseRows';
import { logger } from '@/lib/logging/logger';
import {
  deriveApplicableYear,
  isSupersededProvisionalFactor,
  type FactorPublicationRow,
} from '../engine/resolveEmissionFactor';
import type { EnergyType } from '../types';

/** 再算定が必要な年度と、その対象件数。 */
export interface ProvisionalRecalculationTarget {
  fiscalYearId: string;
  /** fiscal_years.label（画面表示用） */
  fiscalYearLabel: string;
  /** 暫定適用のまま残っている算定済みレコード件数 */
  recordCount: number;
}

/** 差し戻しの結果。 */
export interface ProvisionalRecalculationResetResult {
  fiscalYearId: string;
  fiscalYearLabel: string;
  /** isCalculated = false へ戻したレコード件数 */
  resetCount: number;
}

interface FiscalYearRow {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

/**
 * PostgREST の埋め込みリソース。多対一（emission_results → activity_records / emission_factors）は
 * オブジェクトで返るが、型定義を自動生成していないため supabase-js の推論は配列側に倒れる。
 * 実行時の形に依存しないよう両方受け取れる型にし、取り出しは firstEmbedded に集約する。
 */
type Embedded<T> = T | T[] | null;

const firstEmbedded = <T>(value: Embedded<T>): T | null =>
  Array.isArray(value) ? value[0] ?? null : value;

/** 候補レコード 1 件分（emission_results と、その参照先の必要列だけ）。 */
interface SupersededCandidateRow {
  activityRecordId: string | null;
  activity_records: Embedded<{ periodStart: string; energyType: EnergyType }>;
  emission_factors: Embedded<{ applicableYear: number; isCustom: boolean }>;
}

/** DB内部情報を漏らさないエラー境界: 詳細はサーバーログに出し、呼び出し側へは安全なメッセージだけ throw する。 */
const failWithSafeMessage = (userMessage: string, detail?: unknown): never => {
  if (detail !== undefined) {
    logger.error({ error: detail }, `[provisionalRecalculation] ${userMessage}`);
  }
  throw new Error(userMessage);
};

/**
 * 1 会計年度分の「暫定適用のまま残っている算定済みレコード」の ID を返す。
 *
 * 1 回目のクエリで候補を DB 側に絞らせているのが要点:
 * 暫定適用された係数は必ず `applicableYear < レコードの温対法年度` になる（isProvisionalFactor）。
 * 会計年度に含まれる温対法年度の最大値は終了日の温対法年度なので、
 * `applicableYear < deriveApplicableYear(endDate)` が候補の上位集合になる。この条件と
 * 「公式係数 ＝ isCustom = false」を埋め込みフィルタで押し込めば、通常運用（暫定適用なし）では
 * 0 行しか返らず、画面表示のたびに算定済みレコード全件を引かずに済む。
 * 4月始まりの会計年度では終了日の温対法年度＝会計年度の開始年なので絞り込みの強さは変わらない。
 * 条件は候補の**上位集合**なので、暫定適用だったかの最終判定は純粋コア
 * （isSupersededProvisionalFactor）で行う。
 */
const collectSupersededRecordIds = async (
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  fiscalYear: FiscalYearRow,
): Promise<string[]> => {
  const latestTargetYear = deriveApplicableYear(fiscalYear.endDate);
  if (!Number.isInteger(latestTargetYear)) {
    failWithSafeMessage(`算定年度の終了日が不正です: ${fiscalYear.endDate}`);
  }

  const candidateRows = await fetchAllRows<SupersededCandidateRow>(
    (from, to) =>
      supabase
        .from('emission_results')
        .select(
          'activityRecordId,activity_records!inner(periodStart,energyType,isCalculated),emission_factors!inner(applicableYear,isCustom)',
        )
        .eq('organizationId', organizationId)
        .eq('activity_records.isCalculated', true)
        .gte('activity_records.periodStart', fiscalYear.startDate)
        .lte('activity_records.periodStart', fiscalYear.endDate)
        .eq('emission_factors.isCustom', false)
        .lt('emission_factors.applicableYear', latestTargetYear)
        .order('activityRecordId', { ascending: true })
        .range(from, to),
    '算定済みレコードの取得に失敗しました',
  );

  const candidates = candidateRows.flatMap((row) => {
    const record = firstEmbedded(row.activity_records);
    const factor = firstEmbedded(row.emission_factors);
    return row.activityRecordId && record && factor
      ? [{ id: row.activityRecordId, record, factor }]
      : [];
  });
  if (candidates.length === 0) {
    return [];
  }

  // 候補が使っている energyType と温対法年度に限って「いまの公式係数」を引く
  // （公表済み判定は energyType × applicableYear の有無だけで足りるため 4 列に絞る）。
  // 組織のカスタム係数は officialYearIndex 側で除外されるが、組織が登録した非カスタム係数は
  // 算定バッチと同じく公表済み判定に入れるため、取得範囲は算定バッチと揃える。
  const energyTypes = [...new Set(candidates.map((candidate) => candidate.record.energyType))];
  const targetYears = [
    ...new Set(
      candidates.map((candidate) => deriveApplicableYear(candidate.record.periodStart)),
    ),
  ];

  const publishedFactors = await fetchAllRows<FactorPublicationRow>(
    (from, to) =>
      supabase
        .from('emission_factors')
        .select('energyType,applicableYear,isCustom,status')
        .or(`organizationId.eq.${organizationId},organizationId.is.null`)
        .eq('status', 'active')
        .in('applicableYear', targetYears)
        .in('energyType', energyTypes)
        .order('id', { ascending: true })
        .range(from, to),
    '排出係数の取得に失敗しました',
  );

  const ids = candidates
    .filter((candidate) =>
      isSupersededProvisionalFactor(candidate.factor, candidate.record, publishedFactors),
    )
    .map((candidate) => candidate.id);

  return [...new Set(ids)];
};

/**
 * 組織の全会計年度から「正式係数の公表により再算定が必要な年度」を洗い出す。
 * 対象が無い年度は返さない（画面は返り値が空なら何も表示しない）。
 */
export const findProvisionalRecalculationTargets = async (
  organizationId: string,
): Promise<ProvisionalRecalculationTarget[]> => {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('fiscal_years')
    .select('id,label,startDate,endDate')
    .eq('organizationId', organizationId)
    .order('startDate', { ascending: false });

  if (error) {
    failWithSafeMessage('会計年度の取得に失敗しました', error);
  }

  const fiscalYears = (data ?? []) as FiscalYearRow[];
  const targets = await Promise.all(
    fiscalYears.map(async (fiscalYear) => ({
      fiscalYearId: fiscalYear.id,
      fiscalYearLabel: fiscalYear.label,
      recordCount: (await collectSupersededRecordIds(supabase, organizationId, fiscalYear)).length,
    })),
  );

  return targets.filter((target) => target.recordCount > 0);
};

/**
 * 指定年度の「暫定適用のまま残っている算定済みレコード」を再算定対象（isCalculated = false）へ戻す。
 * 旧 emission_results は DB トリガーが同一トランザクションで削除する。
 * 会計年度が見つからない（他組織の年度・存在しないID）場合は null を返す。
 */
export const resetProvisionalCalculatedRecords = async (params: {
  organizationId: string;
  fiscalYearId: string;
}): Promise<ProvisionalRecalculationResetResult | null> => {
  const { organizationId, fiscalYearId } = params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('fiscal_years')
    .select('id,label,startDate,endDate')
    .eq('id', fiscalYearId)
    .eq('organizationId', organizationId)
    .maybeSingle();

  if (error) {
    // UUID 形式でない fiscalYearId（22P02）は「存在しない年度」として扱う。
    if (error.code === '22P02') {
      return null;
    }
    failWithSafeMessage('算定年度の確認に失敗しました', error);
  }
  if (!data) {
    return null;
  }

  const fiscalYear = data as FiscalYearRow;
  const recordIds = await collectSupersededRecordIds(supabase, organizationId, fiscalYear);

  // .in(...) の URL 長対策でチャンク分割する。チャンクの途中で失敗しても、戻し済みのレコードは
  // 「未算定」として次の算定バッチが拾うため、二重計上や取りこぼしにはならない。
  for (const ids of chunk(recordIds, IN_CHUNK_SIZE)) {
    const { error: updateError } = await supabase
      .from('activity_records')
      .update({ isCalculated: false })
      .eq('organizationId', organizationId)
      .in('id', ids);
    if (updateError) {
      failWithSafeMessage('再算定対象への差し戻しに失敗しました', updateError);
    }
  }

  return {
    fiscalYearId: fiscalYear.id,
    fiscalYearLabel: fiscalYear.label,
    resetCount: recordIds.length,
  };
};
