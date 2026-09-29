// レポートの時間軸の定義（ssbj_report_time_horizons。レポートごとに 1 行）の取得・保存サービス。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。組織分離は RLS が強制する。
// 変更のたびに DB のトリガーが ssbj_reports.draftRevision を進める（docs/ssbj-spec.md §8）。

import { createClient } from '@/lib/supabase/client';
import type { SsbjTimeHorizonDefinitions } from '../types';
import { fromFieldValue, toFieldValue } from '../utils/fieldValue';
import { EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS } from '../utils/timeHorizons';

export interface SsbjTimeHorizonRow {
  shortTermState: string;
  shortTerm: string | null;
  mediumTermState: string;
  mediumTerm: string | null;
  longTermState: string;
  longTerm: string | null;
  planningHorizonRelationState: string;
  planningHorizonRelation: string | null;
  internalNote: string | null;
}

const SELECT_COLUMNS =
  'shortTermState, shortTerm, mediumTermState, mediumTerm, longTermState, longTerm, ' +
  'planningHorizonRelationState, planningHorizonRelation, internalNote';

/** DB 行 → 定義。状態と値が食い違う行は toFieldValue が例外にする（黙って補正しない）。 */
export const toSsbjTimeHorizonDefinitions = (row: SsbjTimeHorizonRow): SsbjTimeHorizonDefinitions => ({
  shortTerm: toFieldValue<string>(row.shortTermState, row.shortTerm),
  mediumTerm: toFieldValue<string>(row.mediumTermState, row.mediumTerm),
  longTerm: toFieldValue<string>(row.longTermState, row.longTerm),
  planningHorizonRelation: toFieldValue<string>(row.planningHorizonRelationState, row.planningHorizonRelation),
  internalNote: row.internalNote,
});

/** 定義 → 書き込む列（状態列＋値列の対に分解する）。 */
export const toSsbjTimeHorizonColumns = (definitions: SsbjTimeHorizonDefinitions): SsbjTimeHorizonRow => {
  const shortTerm = fromFieldValue(definitions.shortTerm);
  const mediumTerm = fromFieldValue(definitions.mediumTerm);
  const longTerm = fromFieldValue(definitions.longTerm);
  const relation = fromFieldValue(definitions.planningHorizonRelation);
  return {
    shortTermState: shortTerm.state,
    shortTerm: shortTerm.value,
    mediumTermState: mediumTerm.state,
    mediumTerm: mediumTerm.value,
    longTermState: longTerm.state,
    longTerm: longTerm.value,
    planningHorizonRelationState: relation.state,
    planningHorizonRelation: relation.value,
    internalNote: definitions.internalNote,
  };
};

/** 定義を取得する。まだ保存していないレポートは、すべて未入力の定義を返す。 */
export const getSsbjTimeHorizons = async (reportId: string): Promise<SsbjTimeHorizonDefinitions> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_report_time_horizons')
    .select(SELECT_COLUMNS)
    .eq('reportId', reportId)
    .maybeSingle();

  if (error) {
    throw new Error('時間軸の定義の取得に失敗しました');
  }
  return data
    ? toSsbjTimeHorizonDefinitions(data as unknown as SsbjTimeHorizonRow)
    : EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS;
};

/**
 * 定義を保存する。行があれば更新し、無ければ作る。
 * upsert（insert … on conflict do update）にしないのは、PostgREST が衝突時の更新に reportId / organizationId も
 * 含めるため。両列は作成後に変えない前提で update の列 GRANT に入れていない。
 */
export const saveSsbjTimeHorizons = async (
  report: { id: string; organizationId: string },
  definitions: SsbjTimeHorizonDefinitions,
): Promise<SsbjTimeHorizonDefinitions> => {
  const supabase = createClient();
  const columns = toSsbjTimeHorizonColumns(definitions);

  const updated = await supabase
    .from('ssbj_report_time_horizons')
    .update(columns)
    .eq('reportId', report.id)
    .select(SELECT_COLUMNS);
  if (updated.error) {
    throw new Error('時間軸の定義の保存に失敗しました');
  }
  const updatedRows = (updated.data ?? []) as unknown as SsbjTimeHorizonRow[];
  if (updatedRows.length > 0) {
    return toSsbjTimeHorizonDefinitions(updatedRows[0]);
  }

  const inserted = await supabase
    .from('ssbj_report_time_horizons')
    .insert({ ...columns, reportId: report.id, organizationId: report.organizationId })
    .select(SELECT_COLUMNS)
    .single();
  if (inserted.error || !inserted.data) {
    // 23505: 別の画面・別の人が同時に最初の定義を作った。
    if (inserted.error?.code === '23505') {
      throw new Error('他の画面で先に保存されました。画面を開き直してから保存し直してください');
    }
    throw new Error('時間軸の定義の保存に失敗しました');
  }
  return toSsbjTimeHorizonDefinitions(inserted.data as unknown as SsbjTimeHorizonRow);
};
