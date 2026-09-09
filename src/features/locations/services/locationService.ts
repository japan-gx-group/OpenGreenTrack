// 拠点データの取得・保存サービス。
// Supabase の locations テーブルへの読み書きを行う（ブラウザ = Client Component からのみ呼ぶこと）。
// getLocations / addLocation はログインユーザーの所属組織を対象とする単一組織向けの契約とする。
// 呼び出し側（Locations / DataInput / Reports）は画面向けの LocationRecord を扱うため、
// このファイルで「DBの列（enum・英語名）」と「画面表示用の LocationRecord」の相互変換を行う。
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { refreshDashboardAggregates } from '@/features/scope-analysis/services/scope3MethodService';
import {
  LOCATION_DELETE_BLOCKED_MESSAGE,
  canDeleteLocation,
  type LocationDeletionImpact,
} from './locationDeletionGuard';
import {
  type LocationRecord,
  type LocationStatus,
  type LocationType,
  type NewLocationInput,
  type Region,
} from '../types';

// locations テーブルの取り扱う列（select / insert 用）。
// 画面が使わない監査列などは含めない。
interface LocationRow {
  id: string;
  name: string;
  region: Region;
  type: LocationType;
  managerName: string | null;
  status: LocationStatus;
  organizationId: string;
}

// scopes 列は無機能のため取り扱わない（insert 時は DB の default '{}' に任せる）。
const SELECT_COLUMNS =
  'id, name, region, type, managerName, status, organizationId';

// --- DB行 ⇔ 画面レコードの相互変換 ------------------------------------------

const toLocationRecord = (row: LocationRow): LocationRecord => {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    type: row.type,
    person: row.managerName ?? '',
    status: row.status,
  };
};

// insert 用の行。id はDB側で採番、organizationId は所属組織の解決後に付与する。
const toInsertRow = (
  location: NewLocationInput,
): Omit<LocationRow, 'id' | 'organizationId'> => ({
  name: location.name,
  region: location.region,
  type: location.type,
  managerName: location.person || null,
  status: location.status,
});

// ログイン中ユーザーの所属組織ID。insert 時に組織を明示する必要がある（RLSのwith checkと一致させる）。
const getCurrentOrganizationId = async (
  supabase: SupabaseClient,
): Promise<string> => {
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
  return data.organizationId as string;
};

// 一覧取得。RLS によりログインユーザーの所属組織の拠点だけが返る。新しい順に並べる。
// createdAt が同値（シードのように1トランザクションで投入した行）でも順序が安定するよう、
// 拠点名を第2ソートキーにする。
export const getLocations = async (): Promise<LocationRecord[]> => {
  const supabase = createClient();
  const query = supabase
    .from('locations')
    .select(SELECT_COLUMNS);
  const { data, error } = await query
    .order('createdAt', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    throw new Error('拠点の取得に失敗しました');
  }
  return ((data ?? []) as unknown as LocationRow[]).map(toLocationRecord);
};

// 単一拠点の取得。存在しない拠点や他組織の拠点（RLSで不可視）の場合は null を返す。
export const getLocationById = async (locationId: string): Promise<LocationRecord | null> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('locations')
    .select(SELECT_COLUMNS)
    .eq('id', locationId)
    .maybeSingle();

  if (error) {
    // URL 直打ちなどで locationId が UUID 形式でない場合（22P02: invalid_text_representation）は
    // 「存在しない拠点」として扱い、通信エラーとは区別して Not Found 表示につなげる。
    if (error.code === '22P02') return null;
    throw new Error('拠点の取得に失敗しました');
  }
  return data ? toLocationRecord(data as LocationRow) : null;
};

// 新規追加。DBで採番された id を含む LocationRecord を返す。
// organizationId は常にログインユーザーの所属組織から解決して作成する。
export const addLocation = async (location: NewLocationInput): Promise<LocationRecord> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { data, error } = await supabase
    .from('locations')
    .insert({ ...toInsertRow(location), organizationId })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    throw new Error('拠点の登録に失敗しました');
  }

  return toLocationRecord(data as unknown as LocationRow);
};

/** 一括処理で行ごとに失敗を返すための結果。index は渡した配列の添字。 */
export interface BulkLocationFailure {
  index: number;
  message: string;
}

// CSVインポートのように多数の書き込みを続けて行う経路では、行ごとの往復回数がそのまま
// 待ち時間になる。addLocation を N 回呼ぶと、組織IDの解決（getUser + profiles）だけで
// 2N 回の往復が乗るため、一括版では組織IDを1回だけ解決して使い回す。
const MAX_PARALLEL_WRITES = 5;

/**
 * CSVインポート用の一括登録。組織IDの解決を1回で済ませ、1リクエストでまとめて insert する。
 * まとめて失敗した場合は1件ずつ入れ直し、どの行が原因かを行単位で返す
 * （取込画面が行番号つきでエラーを出せるようにするため）。
 */
export const addLocations = async (
  locations: NewLocationInput[],
): Promise<{ created: LocationRecord[]; failures: BulkLocationFailure[] }> => {
  if (locations.length === 0) return { created: [], failures: [] };

  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);
  const rows = locations.map(location => ({ ...toInsertRow(location), organizationId }));

  const { data, error } = await supabase.from('locations').insert(rows).select(SELECT_COLUMNS);

  if (!error && data) {
    return { created: (data as unknown as LocationRow[]).map(toLocationRecord), failures: [] };
  }

  // 一括 insert は1行でも弾かれると全体が失敗する。原因行を特定するため1件ずつ入れ直す。
  const created: LocationRecord[] = [];
  const failures: BulkLocationFailure[] = [];
  for (const [index, row] of rows.entries()) {
    const single = await supabase.from('locations').insert(row).select(SELECT_COLUMNS).single();
    if (single.error || !single.data) {
      failures.push({ index, message: single.error?.message ?? '拠点の登録に失敗しました' });
      continue;
    }
    created.push(toLocationRecord(single.data as unknown as LocationRow));
  }
  return { created, failures };
};

/**
 * CSVインポート用の一括更新。更新は行ごとに対象IDが異なり1文にまとめられないため、
 * 同時実行数を絞って並行に流す（行単位の成否はそのまま保つ）。
 */
export const updateLocations = async (
  updates: { id: string; location: NewLocationInput }[],
): Promise<{ updated: LocationRecord[]; failures: BulkLocationFailure[] }> => {
  const supabase = createClient();
  const updated: LocationRecord[] = [];
  const failures: BulkLocationFailure[] = [];

  for (let offset = 0; offset < updates.length; offset += MAX_PARALLEL_WRITES) {
    const chunk = updates.slice(offset, offset + MAX_PARALLEL_WRITES);
    const results = await Promise.all(
      chunk.map(item =>
        supabase
          .from('locations')
          .update(toInsertRow(item.location))
          .eq('id', item.id)
          .select(SELECT_COLUMNS)
          .single(),
      ),
    );
    results.forEach((result, indexInChunk) => {
      const index = offset + indexInChunk;
      if (result.error || !result.data) {
        failures.push({ index, message: result.error?.message ?? '拠点の更新に失敗しました' });
        return;
      }
      updated.push(toLocationRecord(result.data as unknown as LocationRow));
    });
  }

  return { updated, failures };
};

// 既存拠点の更新。編集後の LocationRecord を返す。
// organizationId は変更しない（所属組織の付け替えは対象外）。RLS は組織一致のみを見るため、
// 自組織の拠点であれば所属メンバーの誰でも更新できる（profiles.role による権限差は未導入。
// current_user_can_edit はポリシー未参照）。
export const updateLocation = async (
  locationId: string,
  location: NewLocationInput,
): Promise<LocationRecord> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('locations')
    .update(toInsertRow(location))
    .eq('id', locationId)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    throw new Error('拠点の更新に失敗しました');
  }

  return toLocationRecord(data as unknown as LocationRow);
};

// 拠点削除の影響範囲（紐づく活動量・算定結果の件数、未算定件数、対象期間）を取得する。
// 削除確認モーダルの表示と deleteLocation の事前チェック（V-LOC-004）で使う。
// 件数は head: true + count: 'exact' で行本体を転送せずに取得し、
// 期間は periodStart / periodEnd を昇順・降順の先頭1行だけ読む。
export const getLocationDeletionImpact = async (
  locationId: string,
): Promise<LocationDeletionImpact> => {
  const supabase = createClient();

  const [activity, uncalculated, emission, firstPeriod, lastPeriod] = await Promise.all([
    supabase
      .from('activity_records')
      .select('id', { count: 'exact', head: true })
      .eq('locationId', locationId),
    // 「未算定」は算定エンジン（calculationService）と同じ定義: isCalculated = false。
    supabase
      .from('activity_records')
      .select('id', { count: 'exact', head: true })
      .eq('locationId', locationId)
      .eq('isCalculated', false),
    supabase
      .from('emission_results')
      .select('id', { count: 'exact', head: true })
      .eq('locationId', locationId),
    supabase
      .from('activity_records')
      .select('periodStart')
      .eq('locationId', locationId)
      .order('periodStart', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('activity_records')
      .select('periodEnd')
      .eq('locationId', locationId)
      .order('periodEnd', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (activity.error || uncalculated.error || emission.error || firstPeriod.error || lastPeriod.error) {
    throw new Error('拠点の削除影響の取得に失敗しました');
  }

  return {
    activityRecordCount: activity.count ?? 0,
    emissionResultCount: emission.count ?? 0,
    uncalculatedCount: uncalculated.count ?? 0,
    periodFrom: (firstPeriod.data as { periodStart: string } | null)?.periodStart ?? null,
    periodTo: (lastPeriod.data as { periodEnd: string } | null)?.periodEnd ?? null,
  };
};

// Scope3積上げレコード（energyType='scope3_activity'）の件数を数える。
// 拠点削除ガード（docs/idea-scope3-spec.md §3.5）: emission_results は locations を
// on delete cascade で参照するため、積上げレコードを持つ拠点を削除すると Scope3 の
// 算定結果が黙って消えて scope3Total（calculated 方式）が崩れる。削除前にこの件数を
// 確認し、1件でもあれば削除をブロックして明細の移動または削除を案内する。
export const countScope3StackedRecords = async (locationId: string): Promise<number> => {
  const supabase = createClient();
  const { count, error } = await supabase
    .from('activity_records')
    .select('id', { count: 'exact', head: true })
    .eq('locationId', locationId)
    .eq('energyType', 'scope3_activity');

  if (error) {
    throw new Error('Scope3積上げデータの確認に失敗しました');
  }
  return count ?? 0;
};

// 拠点削除をブロックしたときの案内文（モーダル表示・例外メッセージで共用）。
export const buildScope3DeleteBlockMessage = (count: number): string =>
  `この拠点にはScope3積上げデータが${count}件登録されているため削除できません。` +
  'データ入力画面の入力履歴から、該当明細を別拠点へ移動するか削除したうえで再度お試しください。';

// 削除対象の拠点の算定結果（emission_results）が属する会計年度IDを集める。
// 年度ごとに head + count（行本体は転送しない）で「その年度期間の活動量に紐づく算定結果が
// 1件でもあるか」を確認する。算定結果を全行取得して periodStart を年度へ振り分ける方法は
// PostgREST の既定上限（1000行）を超えると年度を取りこぼすため採らない。
// 年度は fiscal_years（RLS で自組織の行のみ）から取る。数年〜十数年ぶんなのでクエリ数は小さい。
const getFiscalYearIdsWithEmissionResults = async (
  supabase: SupabaseClient,
  locationId: string,
): Promise<string[]> => {
  const { data: fiscalYears, error: fiscalYearsError } = await supabase
    .from('fiscal_years')
    .select('id, startDate, endDate');
  if (fiscalYearsError) {
    throw new Error('算定年度の取得に失敗しました');
  }

  const rows = (fiscalYears ?? []) as { id: string; startDate: string; endDate: string }[];
  const counts = await Promise.all(
    rows.map(fiscalYear =>
      supabase
        .from('emission_results')
        // activity_records!inner: 活動量に紐づかない行（Scope3 集計行など）は期間を持たないため除外する
        .select('id, activity_records!inner(periodStart)', { count: 'exact', head: true })
        .eq('locationId', locationId)
        .gte('activity_records.periodStart', fiscalYear.startDate)
        .lte('activity_records.periodStart', fiscalYear.endDate),
    ),
  );

  if (counts.some(result => result.error)) {
    throw new Error('算定結果の確認に失敗しました');
  }

  return rows
    .filter((_, index) => (counts[index].count ?? 0) > 0)
    .map(fiscalYear => fiscalYear.id);
};

/** 拠点削除の結果。削除自体は成功しており、集計の再計算だけ失敗した年度があれば warning に入る。 */
export interface LocationDeleteResult {
  /** 集計を再計算した年度ID */
  refreshedFiscalYearIds: string[];
  /** 集計の再計算に失敗した場合の案内文。すべて成功なら null */
  warning: string | null;
}

// 拠点の削除。RLS は組織一致のみを見るため、自組織の拠点であれば所属メンバーの誰でも削除できる
// （profiles.role による権限差は未導入）。
// ⚠️ activity_records / emission_results は locations を on delete cascade で参照しているため、
//   拠点を削除すると紐づく活動量データ・算定結果も連鎖削除される（呼び出し側で明示的に警告すること）。
// V-LOC-004（機能仕様 §5.2）: 未算定（isCalculated = false）の活動量データが1件でも残る拠点は
// 削除できない。UI 側の無効化とは別に、サービス側でも直前に必ず再チェックして安全側に倒す。
// V-LOC-005（機能仕様 §5.2 / IDEA連携Scope3算定仕様 §3.5）: Scope3積上げレコードを持つ拠点は削除不可。画面側（Locations.client.tsx）でも
//   事前チェックして案内するが、確認からの時間差で明細が増えるケースに備え、ここでも検証する。
// 削除後は dashboard_aggregates（KPI・レポート・削減目標の正本）を再計算する。cascade で
//   emission_results は消えるが集計行は自動では更新されず、次の算定バッチまで削除済み拠点の
//   排出量が KPI に残り続けるため。対象年度は削除前に控えておく（削除後は行が無く特定できない）。
//   再計算の失敗は削除を取り消さず、呼び出し側へ警告として返す。
export const deleteLocation = async (locationId: string): Promise<LocationDeleteResult> => {
  const impact = await getLocationDeletionImpact(locationId);
  if (!canDeleteLocation(impact)) {
    throw new Error(LOCATION_DELETE_BLOCKED_MESSAGE);
  }

  const supabase = createClient();

  const scope3RecordCount = await countScope3StackedRecords(locationId);
  if (scope3RecordCount > 0) {
    throw new Error(buildScope3DeleteBlockMessage(scope3RecordCount));
  }

  // 算定結果が無い拠点なら年度の特定クエリ自体を省く（件数は impact で取得済み）。
  const affectedFiscalYearIds =
    impact.emissionResultCount > 0
      ? await getFiscalYearIdsWithEmissionResults(supabase, locationId)
      : [];

  const { error } = await supabase
    .from('locations')
    .delete()
    .eq('id', locationId);

  if (error) {
    throw new Error('拠点の削除に失敗しました');
  }

  const refreshedFiscalYearIds: string[] = [];
  const failedFiscalYearIds: string[] = [];
  for (const fiscalYearId of affectedFiscalYearIds) {
    try {
      await refreshDashboardAggregates(fiscalYearId);
      refreshedFiscalYearIds.push(fiscalYearId);
    } catch {
      failedFiscalYearIds.push(fiscalYearId);
    }
  }

  return {
    refreshedFiscalYearIds,
    warning:
      failedFiscalYearIds.length > 0
        ? `拠点は削除しましたが、${failedFiscalYearIds.length}年度分のダッシュボード集計の更新に失敗しました。次回の算定実行時に更新されます`
        : null,
  };
};
