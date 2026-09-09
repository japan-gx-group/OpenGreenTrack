// GHG自動算定バッチのサービス層（I/O）。
// 純粋な計算コア（../engine）で算定し、算定結果の確定は Postgres 関数
// run_calculation_commit（単一トランザクション）に委ねる。
//
// 書き込みを1回のRPCにまとめる理由:
//   supabase-js は複数の書き込みを個別HTTPで発行するため、複数ステップに分けると
//   途中失敗で二重計上/欠損が起きる。RPC内で all-or-nothing にし、
//   ダッシュボード集計も emission_results から絶対値で再計算する（ドリフト防止）。
//
// ⚠️ サーバ専用: service_role の管理クライアント（src/lib/supabase/admin.ts）を使う。
// Client Component から import しないこと（AGENTS.md R7）。
//
// 係数解決の優先順位・単位換算・Scope3集計の方針は docs/calculation-logic.md を参照。

import { createAdminClient } from '@/lib/supabase/admin';
import {
  CALCULATION_CONCURRENT_LIMIT,
  CALCULATION_PENDING_WINDOW_MS,
  CALCULATION_PER_MINUTE_LIMIT,
  HEAVY_API_SQLSTATE,
  RATE_LIMIT_WINDOW_MS,
  getCalculationRateLimitError,
  getCalculationRequestError,
} from '@/lib/security/apiRateLimit';
import { IN_CHUNK_SIZE, chunk, fetchAllRows } from '@/lib/supabaseRows';
import { REGION_LABELS, type Region } from '@/types/region';
import { computeEmissions, roundEmissions } from '../engine/computeEmissions';
import {
  applicableYearsForFiscalYear,
  withProvisionalYears,
} from '../engine/resolveEmissionFactor';
import { computeScope3Emissions } from './scope3Calculation';
import { logger } from '@/lib/logging/logger';
import type {
  ActivityRecordRow,
  CalculationWarning,
  EmissionFactorRow,
  IdeaFactorRow,
  IdeaImportRow,
  UnresolvedRecord,
} from '../types';

export interface RunCalculationBatchParams {
  organizationId: string;
  fiscalYearId: string;
}

export interface CalculationBatchSummary {
  batchId: string;
  status: 'completed' | 'failed';
  /** 算定できた活動量レコード件数 */
  processedCount: number;
  /** このバッチで算定した Scope1/2 排出量の合計 (t-CO2e)。RPC run_calculation_commit が scope1/scope2 の結果だけを合算する（Scope3 は含まない） */
  totalEmissionsDelta: number;
  /** 係数未解決などで未算定のまま残ったレコード */
  unresolved: UnresolvedRecord[];
  /** 算定はできたが、明示選択した係数どおりには算定できなかったレコード（読み替え・フォールバック） */
  warnings: CalculationWarning[];
  /** エラー時のメッセージ */
  errorMessage?: string;
}

/** supabase-js が numeric を文字列で返す場合に備えて number へ正規化する */
const toNumber = (value: unknown): number => Number(value);

/** DB内部情報を漏らさないエラー境界: 詳細はサーバーログに出し、呼び出し側へは安全なメッセージだけ throw する。 */
const failWithSafeMessage = (userMessage: string, detail?: unknown): never => {
  if (detail !== undefined) {
    logger.error({ error: detail }, `[runCalculationBatch] ${userMessage}`);
  }
  throw new Error(userMessage);
};

const createCalculationBatch = async (
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  fiscalYearId: string,
): Promise<string> => {
  const now = Date.now();
  const pendingSince = new Date(now - CALCULATION_PENDING_WINDOW_MS).toISOString();
  const recentSince = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();

  // 判定とバッチ作成はDB関数内で組織単位の advisory lock を取って行う。
  // Route Handler 側で count → insert に分けると、完全同時リクエストで上限をすり抜け得るため。
  const { data, error } = await supabase.rpc('create_calculation_batch_with_rate_limit', {
    p_organization_id: organizationId,
    p_fiscal_year_id: fiscalYearId,
    p_pending_since: pendingSince,
    p_recent_since: recentSince,
    p_pending_limit: CALCULATION_CONCURRENT_LIMIT,
    p_recent_limit: CALCULATION_PER_MINUTE_LIMIT,
  });

  if (error) {
    const rateLimitError = getCalculationRateLimitError(error);
    if (rateLimitError) {
      throw rateLimitError;
    }
    const requestError = getCalculationRequestError(error);
    if (requestError) {
      throw requestError;
    }
    logger.error({ error, organizationId, fiscalYearId }, '算定バッチの作成に失敗しました');
    throw new Error('算定バッチの作成に失敗しました');
  }

  if (typeof data !== 'string') {
    logger.error({ data, organizationId, fiscalYearId }, '算定バッチIDが不正です');
    throw new Error('算定バッチの作成に失敗しました');
  }
  return data;
};

/**
 * 未算定の活動量レコードに排出係数を適用して算定し、結果を保存する。
 *
 * 手順:
 *  1. calculation_batches に実行記録を作成
 *  2. activity_records（未算定・対象年度内）と emission_factors（active・会計年度に含まれる温対法年度）を取得。
 *     Scope3積上げレコード（energyType='scope3_activity'）は別クエリで取得し、
 *     参照する idea_factors / idea_imports と合わせて Scope1/2 とは分離して算定する（§4.3）
 *  3. 純粋コア computeEmissions で算定（Scope3 は computeScope3Emissions 経由の分離呼び出し）
 *  4. run_calculation_commit（RPC・単一トランザクション）で結果保存・isCalculated更新・
 *     dashboard_aggregates 再計算（refresh_dashboard_aggregates）・バッチ完了 を原子的に実行
 *  5. サマリ（未算定一覧を含む）を返す
 */
export const runCalculationBatch = async (
  params: RunCalculationBatchParams,
): Promise<CalculationBatchSummary> => {
  const { organizationId, fiscalYearId } = params;
  const supabase = createAdminClient();

  // 1. バッチ作成（メタデータ。データ確定は後段のRPCで原子的に行う）
  const batchId = await createCalculationBatch(supabase, organizationId, fiscalYearId);

  try {
    // 対象年度の期間を取得（活動量の絞り込みに使う）
    const { data: fiscalYear, error: fyError } = await supabase
      .from('fiscal_years')
      .select('startDate,endDate')
      .eq('id', fiscalYearId)
      .single();
    if (fyError || !fiscalYear) {
      logger.error({ error: fyError, fiscalYearId }, '会計年度が見つかりません');
      throw new Error('算定年度が見つかりません');
    }

    // 係数解決コンテキストの applicableYear は会計年度の開始年（有効期間を持たないカスタム係数は
    // この年で登録される）。一方、公式係数は 4月〜翌3月の温対法年度＋有効期間で生成されるため、
    // 非4月始まりの会計年度は途中で温対法年度をまたぎ、開始年の係数だけでは後半の月が有効期間外になる。
    // 取得は会計年度に含まれ得る温対法年度をすべて対象にし（applicableYearsForFiscalYear）、
    // レコードごとの突き合わせは resolveEmissionFactor 側（applicableYearsForRecord）に委ねる。
    // 対象年度の公式係数が未公表の間は直近の過年度を暫定適用するため、取得範囲には
    // withProvisionalYears でフォールバック年度も足す（どの年度を実際に使うかの判定は純粋コア側）。
    const applicableYear = Number(fiscalYear.startDate.slice(0, 4));
    if (!Number.isInteger(applicableYear)) {
      failWithSafeMessage(`算定年度の開始日が不正です: ${fiscalYear.startDate}`);
    }
    const factorYears = withProvisionalYears(
      applicableYearsForFiscalYear(fiscalYear.startDate, fiscalYear.endDate),
    );

    // 活動量取得の共通 select 列。`scope3CategoryId` / `ideaFactorId` を必ず含める
    // （欠落しても例外は出ず、categoryId=null で保存され §5.1 の calculated 集計が黙って
    // 0 になる。docs/idea-scope3-spec.md §4.3-1）。
    const activitySelect =
      'id,organizationId,locationId,energyType,amount,unit,periodStart,periodEnd,isCalculated,emissionFactorId,scope3CategoryId,ideaFactorId';

    // 相互依存の無い4クエリ（Scope1/2活動量・Scope3活動量・係数・拠点）を並列発行して
    // ラウンドトリップを減らす。
    // 活動量と係数は PostgREST の max_rows(1000) で黙って切り詰められると誤算定・未算定を招くため、
    // fetchAllRows でページングして全行取得する（公式係数の投入で係数は年間約3,000行になる）。
    const [activityRows, scope3ActivityRows, factorRows, locationResult] = await Promise.all([
      // 未算定の活動量。年度帰属は periodStart 基準で一意（またぎレコードも二重計上なし。RPC 側の集計も同基準）。
      // Scope3積上げレコードの混入を防ぐため energyType で明示分離する（§4.3-1。
      // activity_records.energyType は NOT NULL のため .neq で既存行が脱落することはない）。
      fetchAllRows<ActivityRecordRow>(
        (from, to) =>
          supabase
            .from('activity_records')
            .select(activitySelect)
            .eq('organizationId', organizationId)
            .eq('isCalculated', false)
            .neq('energyType', 'scope3_activity')
            .gte('periodStart', fiscalYear.startDate)
            .lte('periodStart', fiscalYear.endDate)
            .order('id', { ascending: true })
            .range(from, to),
        '活動量の取得に失敗しました',
      ),
      // Scope3積上げ（IDEA連携）の未算定レコード。孤児（ideaFactorId=null）も取得し、
      // computeScope3Emissions 側で SCOPE3_FACTOR_MISSING として未解決に載せる（§4.3-1）。
      fetchAllRows<ActivityRecordRow>(
        (from, to) =>
          supabase
            .from('activity_records')
            .select(activitySelect)
            .eq('organizationId', organizationId)
            .eq('isCalculated', false)
            .eq('energyType', 'scope3_activity')
            .gte('periodStart', fiscalYear.startDate)
            .lte('periodStart', fiscalYear.endDate)
            .order('id', { ascending: true })
            .range(from, to),
        'Scope3活動量の取得に失敗しました',
      ),
      // 有効な排出係数。会計年度に含まれ得る温対法年度（factorYears）で絞り込む。
      // scope は絞らない: seed の scope3 標準係数（廃棄物・輸送・出張・通勤）で算定するレコードは
      // computeEmissions が energyType から categoryId を補って scope3 の結果にする。
      // IDEA 積上げ（scope3_activity）は別クエリ・別係数テーブルで分離済みのため混ざらない。
      // 公式係数（organizationId is null の全組織共通マスタ）も対象に含める。
      // service_role クライアントは RLS を通らないため、ここで明示的に絞り込む必要がある。
      fetchAllRows<EmissionFactorRow>(
        (from, to) =>
          supabase
            .from('emission_factors')
            .select('id,organizationId,name,energyType,scope,factorValue,unit,applicableYear,regionName,status,isCustom,locationId,supplierId,effectiveFrom,effectiveTo,providerName,providerNumber,menuName,factorType')
            .or(`organizationId.eq.${organizationId},organizationId.is.null`)
            .eq('status', 'active')
            .in('applicableYear', factorYears)
            .order('id', { ascending: true })
            .range(from, to),
        '排出係数の取得に失敗しました',
      ),
      // 拠点 → 地域名（regionName 突き合わせ用）マップ用。
      supabase
        .from('locations')
        .select('id,region')
        .eq('organizationId', organizationId),
    ]);

    if (locationResult.error) {
      failWithSafeMessage('拠点の取得に失敗しました', locationResult.error);
    }

    // 数値カラム（amount / factorValue）は supabase-js が文字列で返し得るため number へ正規化する。
    const records: ActivityRecordRow[] = activityRows.map((row) => ({
      ...row,
      amount: toNumber(row.amount),
    }));

    const scope3Records: ActivityRecordRow[] = scope3ActivityRows.map((row) => ({
      ...row,
      amount: toNumber(row.amount),
    }));

    const factors: EmissionFactorRow[] = factorRows.map((row) => ({
      ...row,
      factorValue: toNumber(row.factorValue),
    }));

    // Scope3積上げレコードが参照する IDEA 係数と、その版情報（appliedFactorName 用）を取得。
    // isActive は問わない（旧版参照の算定済み再実行は無く、未算定は取込完了時に新版へ
    // 再マッピング済み。§4.3-1）。gwpValue / baseFlowAmount は無制約 numeric の原典精度を
    // 保つため string のまま渡し、正規化（normalizeIdeaFactor）内で Number() 変換する。
    const ideaFactorIds = [
      ...new Set(
        scope3Records
          .map((record) => record.ideaFactorId)
          .filter((id): id is string => typeof id === 'string' && id !== ''),
      ),
    ];
    const ideaFactors: IdeaFactorRow[] = (
      await Promise.all(
        chunk(ideaFactorIds, IN_CHUNK_SIZE).map(async (ids) => {
          const { data, error } = await supabase
            .from('idea_factors')
            .select('id,organizationId,importId,ideaCode,productName,baseFlowAmount,unit,gwpValue')
            .eq('organizationId', organizationId)
            .in('id', ids);
          if (error) {
            failWithSafeMessage('IDEA係数の取得に失敗しました', error);
          }
          return (data ?? []) as IdeaFactorRow[];
        }),
      )
    ).flat();

    const ideaImportIds = [...new Set(ideaFactors.map((factor) => factor.importId))];
    const ideaImports: IdeaImportRow[] = (
      await Promise.all(
        chunk(ideaImportIds, IN_CHUNK_SIZE).map(async (ids) => {
          const { data, error } = await supabase
            .from('idea_imports')
            .select('id,version')
            .eq('organizationId', organizationId)
            .in('id', ids);
          if (error) {
            failWithSafeMessage('IDEAインポート記録の取得に失敗しました', error);
          }
          return (data ?? []) as IdeaImportRow[];
        }),
      )
    ).flat();

    const locationRegionName = new Map<string, string>();
    for (const loc of locationResult.data ?? []) {
      locationRegionName.set(loc.id, REGION_LABELS[loc.region as Region] ?? '');
    }

    // 4. 純粋コアで算定（年度・地域名を注入）
    const { results, unresolved, warnings } = computeEmissions(records, factors, {
      resolveContext: (record) => ({
        applicableYear,
        regionName: locationRegionName.get(record.locationId) ?? null,
      }),
    });

    // 4'. Scope3積上げは Scope1/2 と分離した呼び出しで算定する（§4.3-2 の多層防御）。
    //     結果は FK 詰め替え済み（emissionFactorId=null / ideaFactorId セット。§4.3-4）。
    const scope3Outcome = computeScope3Emissions(
      scope3Records,
      ideaFactors,
      ideaImports,
      applicableYear,
    );

    const allResults = [...results, ...scope3Outcome.results];
    const allUnresolved = [...unresolved, ...scope3Outcome.unresolved];
    const allWarnings = [...warnings, ...scope3Outcome.warnings];

    // 5. 算定結果の確定（RPC・単一トランザクション）。処理件数・排出量合計は RPC の戻り値を
    //    単一情報源とし、TS 側で再集計しない（集計ドリフト防止）。
    const { data: commitSummary, error: commitError } = await supabase.rpc('run_calculation_commit', {
      p_batch_id: batchId,
      p_organization_id: organizationId,
      p_fiscal_year_id: fiscalYearId,
      p_results: allResults,
    });
    if (commitError) {
      // 実行が長引いて先にバッチが滞留として回収された場合。結果は何も書かれていないので、
      // 利用者には「再実行すれば良い」ことだけ伝える。
      if (commitError.code === HEAVY_API_SQLSTATE.calculationBatchNotPending) {
        failWithSafeMessage(
          '算定の実行時間が上限を超えたため、結果を破棄しました。再度算定を実行してください。',
          commitError,
        );
      }
      failWithSafeMessage('算定結果の確定に失敗しました', commitError);
    }

    const summary = (commitSummary ?? {}) as {
      processedCount?: number;
      totalEmissionsDelta?: number;
    };

    return {
      batchId,
      status: 'completed',
      processedCount: summary.processedCount ?? allResults.length,
      totalEmissionsDelta: roundEmissions(toNumber(summary.totalEmissionsDelta ?? 0)),
      unresolved: allUnresolved,
      warnings: allWarnings,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // RPC は原子的なので、失敗時はデータ確定なし＝処理0件。バッチを失敗として記録する。
    // 滞留として先に failed へ回収されていた場合は、回収時の errorMessage を上書きしない（pending のときだけ書く）。
    const { error: updateError } = await supabase
      .from('calculation_batches')
      .update({ status: 'failed', errorMessage, completedAt: new Date().toISOString() })
      .eq('id', batchId)
      .eq('status', 'pending');
    if (updateError) {
      // 失敗記録に失敗するとバッチが pending のまま残り原因も失われるため、確実にログへ残す。
      logger.error({ error: updateError, batchId }, 'バッチの失敗状態の記録に失敗');
    }

    return {
      batchId,
      status: 'failed',
      processedCount: 0,
      totalEmissionsDelta: 0,
      unresolved: [],
      warnings: [],
      errorMessage,
    };
  }
};
