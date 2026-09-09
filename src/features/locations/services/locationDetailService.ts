// 拠点別Scope内訳詳細画面のデータ取得サービス（ブラウザ = Client Component からのみ呼ぶこと）。
// activity_records を拠点ID + 年度期間で取得し、紐づく emission_results と結合して
// locationDetailAggregation（純粋関数）で集計する。
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { getFiscalYearStartMonthFromDate } from '@/lib/fiscal-year/fiscalYearPeriod';
import { resolveFiscalYearDateRange } from '@/lib/fiscal-year/fiscalYearLookup';
import { chunk, fetchAllRows, IN_CHUNK_SIZE } from '@/lib/supabaseRows';
import {
  buildLocationDetailData,
  type DetailActivityRecord,
  type DetailEmissionResult,
  type LocationDetailData,
} from './locationDetailAggregation';

export type { LocationDetailData } from './locationDetailAggregation';

// 当該拠点・当年度の活動量レコード。RLS により自組織の行のみ返る。
const getActivityRecords = async (
  supabase: SupabaseClient,
  period: { startDate: string; endDate: string },
  locationId: string,
): Promise<DetailActivityRecord[]> =>
  fetchAllRows<DetailActivityRecord>(
    (from, to) =>
      supabase
        .from('activity_records')
        .select('id, energyType, amount, unit, periodStart')
        .eq('locationId', locationId)
        .gte('periodStart', period.startDate)
        .lte('periodStart', period.endDate)
        .order('id', { ascending: true })
        .range(from, to),
    '活動量データの取得に失敗しました',
  );

// 活動量レコードに紐づく排出結果を取得する。
// IDリストを分割（414 URI Too Long 回避）し、各チャンクを range() でページングして取得する。
const getEmissionResults = async (
  supabase: SupabaseClient,
  activityRecordIds: string[],
): Promise<DetailEmissionResult[]> => {
  if (activityRecordIds.length === 0) return [];

  const results: DetailEmissionResult[] = [];
  for (const idsChunk of chunk(activityRecordIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllRows<DetailEmissionResult>(
      (from, to) =>
        supabase
          .from('emission_results')
          .select('activityRecordId, scope, emissions')
          .in('activityRecordId', idsChunk)
          .order('id', { ascending: true })
          .range(from, to),
      '排出量データの取得に失敗しました',
    );
    results.push(...rows);
  }

  return results;
};

// 拠点詳細（その拠点 × 選択中年度）の集計データを取得する。
// 存在しない・他組織の locationId は RLS により活動量が0件になるだけなので、
// 「拠点が見つかりません」の判定は呼び出し側で getLocationById の結果を使って行う。
export const getLocationDetailData = async (
  fiscalYear: string,
  locationId: string,
  fiscalYearId?: string | null,
): Promise<LocationDetailData> => {
  const supabase = createClient();
  const period = await resolveFiscalYearDateRange(supabase, fiscalYear, fiscalYearId);
  const fiscalYearStartMonth = getFiscalYearStartMonthFromDate(period.startDate);

  const activityRecords = await getActivityRecords(supabase, period, locationId);
  const emissionResults = await getEmissionResults(
    supabase,
    activityRecords.map(record => record.id),
  );

  return buildLocationDetailData(activityRecords, emissionResults, { fiscalYearStartMonth });
};
