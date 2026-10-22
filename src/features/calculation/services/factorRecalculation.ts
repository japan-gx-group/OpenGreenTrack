// 組織の排出係数（カスタム係数）の値を変えたときの、算定済みレコードの再算定対象への差し戻し（I/O）。
//
// 背景:
//   係数の編集は emission_factors の行を上書きするが、算定済みの結果（emission_results）は
//   算定時の値のまま残る。算定バッチ（calculationService）は isCalculated = false のレコードしか
//   処理しないため、放置すると同じ年度の中に変更前の値と変更後の値で算定した結果が混在する。
//   係数管理画面で値・単位を変えた利用者が「再算定する」を選んだとき、その係数で算定済みの
//   レコードを isCalculated = false へ戻す。旧 emission_results は DB トリガー
//   （clear_emission_results_on_recalculation）が同一トランザクションで消すため、差し戻した時点で
//   二重計上は起きない。差し戻し後の算定は既存の /api/calculations に任せる（provisionalRecalculation と同じ流れ）。
//   ⚠️ 差し戻しから算定までの間、そのレコードの排出量は dashboard_aggregates に残った古い値のまま。
//   呼び出し側は差し戻しに続けて必ず算定を実行すること。実行できなかった場合もレコードは「未算定」として
//   データ入力画面・レポートの「データ充足状況」に出るため、黙って消えることはない。
//
// ⚠️ サーバ専用: service_role の管理クライアント（src/lib/supabase/admin.ts）を使う。
// Client Component から import しないこと（AGENTS.md R7）。呼び出し元の Route Handler で
// 「ログイン済み・自組織のみ」を検証する。

import { createAdminClient } from '@/lib/supabase/admin';
import { IN_CHUNK_SIZE, chunk, fetchAllRows } from '@/lib/supabaseRows';
import { logger } from '@/lib/logging/logger';

/** 差し戻しの結果。 */
export interface FactorRecalculationResetResult {
  /** isCalculated = false へ戻したレコード件数 */
  resetCount: number;
  /** 算定年度が登録されていないため戻さなかったレコード件数（戻すと算定できないまま結果だけが消えるため） */
  skippedCount: number;
  /** 戻したレコードが属する会計年度（呼び出し側が続けて /api/calculations で算定する） */
  fiscalYearIds: string[];
}

interface FiscalYearRow {
  id: string;
  startDate: string;
  endDate: string;
}

/**
 * PostgREST の埋め込みリソース。多対一（emission_results → activity_records）はオブジェクトで返るが、
 * 型定義を自動生成していないため supabase-js の推論は配列側に倒れる。両方受け取れる型にする。
 */
type Embedded<T> = T | T[] | null;
const firstEmbedded = <T>(value: Embedded<T>): T | null =>
  Array.isArray(value) ? value[0] ?? null : value;

interface CalculatedRecordRow {
  activityRecordId: string | null;
  activity_records: Embedded<{ periodStart: string }>;
}

/** DB内部情報を漏らさないエラー境界: 詳細はサーバーログに出し、呼び出し側へは安全なメッセージだけ throw する。 */
const failWithSafeMessage = (userMessage: string, detail?: unknown): never => {
  if (detail !== undefined) {
    logger.error({ error: detail }, `[factorRecalculation] ${userMessage}`);
  }
  throw new Error(userMessage);
};

/**
 * レコードの periodStart が属する会計年度の ID。年度帰属は算定バッチ・refresh_dashboard_aggregates と同じ
 * periodStart 基準。どの年度にも属さなければ null。
 */
export const fiscalYearIdForPeriodStart = (
  fiscalYears: FiscalYearRow[],
  periodStart: string,
): string | null =>
  fiscalYears.find((fiscalYear) => fiscalYear.startDate <= periodStart && periodStart <= fiscalYear.endDate)
    ?.id ?? null;

/**
 * 指定した組織の係数で算定済みのレコードを、再算定対象（isCalculated = false）へ戻す。
 * 係数が自組織のものでない（公式係数・他組織の係数・存在しないID）場合は null を返す。
 * 公式係数の値の差し替えは seed の再投入で行い、再算定は暫定適用の再算定の導線で扱うため対象外。
 */
export const resetRecordsCalculatedWithFactor = async (params: {
  organizationId: string;
  factorId: string;
}): Promise<FactorRecalculationResetResult | null> => {
  const { organizationId, factorId } = params;
  const supabase = createAdminClient();

  const { data: factor, error: factorError } = await supabase
    .from('emission_factors')
    .select('id')
    .eq('id', factorId)
    .eq('organizationId', organizationId)
    .maybeSingle();
  if (factorError) {
    // UUID 形式でない factorId（22P02）は「存在しない係数」として扱う。
    if (factorError.code === '22P02') {
      return null;
    }
    failWithSafeMessage('排出係数の確認に失敗しました', factorError);
  }
  if (!factor) {
    return null;
  }

  // emission_results.emissionFactorId は算定時に実際に適用した係数（明示選択・自動解決の別を問わない）。
  const calculatedRows = await fetchAllRows<CalculatedRecordRow>(
    (from, to) =>
      supabase
        .from('emission_results')
        .select('activityRecordId,activity_records!inner(periodStart)')
        .eq('organizationId', organizationId)
        .eq('emissionFactorId', factorId)
        .order('activityRecordId', { ascending: true })
        .range(from, to),
    '算定済みレコードの取得に失敗しました',
  );
  const records = calculatedRows.flatMap((row) => {
    const record = firstEmbedded(row.activity_records);
    return row.activityRecordId && record
      ? [{ id: row.activityRecordId, periodStart: record.periodStart }]
      : [];
  });
  if (records.length === 0) {
    return { resetCount: 0, skippedCount: 0, fiscalYearIds: [] };
  }

  const { data: fiscalYearData, error: fiscalYearError } = await supabase
    .from('fiscal_years')
    .select('id,startDate,endDate')
    .eq('organizationId', organizationId);
  if (fiscalYearError) {
    failWithSafeMessage('算定年度の取得に失敗しました', fiscalYearError);
  }
  const fiscalYears = (fiscalYearData ?? []) as FiscalYearRow[];

  // 算定バッチは年度単位で動くため、どの年度にも属さないレコードを戻すと、旧結果だけが消えて
  // 算定し直せないまま残る。年度に属するレコードだけを戻す。
  const targets = records.flatMap((record) => {
    const fiscalYearId = fiscalYearIdForPeriodStart(fiscalYears, record.periodStart);
    return fiscalYearId ? [{ id: record.id, fiscalYearId }] : [];
  });

  // .in(...) の URL 長対策でチャンク分割する。チャンクの途中で失敗しても、戻し済みのレコードは
  // 「未算定」として次の算定バッチが拾うため、二重計上や取りこぼしにはならない。
  for (const ids of chunk(targets.map((target) => target.id), IN_CHUNK_SIZE)) {
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
    resetCount: targets.length,
    skippedCount: records.length - targets.length,
    fiscalYearIds: [...new Set(targets.map((target) => target.fiscalYearId))],
  };
};
