// 手動入力の活動量レコード取得・保存サービス。
// Supabase の activity_records テーブルへ、RLS 前提でブラウザから書き込む。
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { IN_CHUNK_SIZE, chunk, fetchAllRows } from '@/lib/supabaseRows';
import type { EnergyType } from '@/features/calculation/types';
import type { Region } from '@/types/region';
import {
  MANUAL_ACTIVITY_CATEGORY_MAP,
  type ManualActivityRecordInput,
  type ManualEntryLocationOption,
  type SavedManualActivityRecord,
  type Scope3ActivityRecordInput,
} from '../types';
import {
  buildActivityRecordDuplicateKey,
  buildDuplicateActivityRecordMessage,
  formatDuplicatePeriodLabel,
  hasDuplicateActivityRecord,
  isDuplicateActivityRecordError,
  type ActivityRecordDuplicateKeyFields,
} from './activityRecordDuplicates';

interface ProfileOrganizationRow {
  organizationId: string;
}

interface LocationOptionRow {
  id: string;
  name: string;
}

// 手動入力フォームの拠点選択肢用の行。係数の地域一致解決のため region も取得する。
interface ManualEntryLocationRow extends LocationOptionRow {
  region: Region;
}

// Scope3積上げレコードの履歴表示用に埋め込む IDEA 製品情報。
interface IdeaFactorEmbedRow {
  id: string;
  productName: string;
}

interface ActivityRecordRow {
  id: string;
  locationId: string;
  energyType: EnergyType;
  amount: string | number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  emissionFactorId: string | null;
  // Scope3積上げレコード（energyType='scope3_activity'）のみ非null。
  scope3CategoryId: number | null;
  ideaFactorId: string | null;
  createdAt: string;
  locations: LocationOptionRow | LocationOptionRow[] | null;
  idea_factors: IdeaFactorEmbedRow | IdeaFactorEmbedRow[] | null;
}

// 取得・保存後の返却で共通に使う select 列。Scope3積上げ列と IDEA 製品名の
// 埋め込みを追加した（Scope1/2 レコードでは null が返るだけで挙動は変わらない）。
const ACTIVITY_RECORD_SELECT =
  'id, locationId, energyType, amount, unit, periodStart, periodEnd, note, emissionFactorId, scope3CategoryId, ideaFactorId, createdAt, locations(id, name), idea_factors(id, productName)';

type ActivityRecordDuplicateKeyRow = ActivityRecordDuplicateKeyFields;

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

  return (data as ProfileOrganizationRow).organizationId;
};

const toLocationOptionRow = (
  locations: ActivityRecordRow['locations'],
): LocationOptionRow | null => {
  if (Array.isArray(locations)) {
    return locations[0] ?? null;
  }
  return locations;
};

const toIdeaFactorEmbedRow = (
  ideaFactors: ActivityRecordRow['idea_factors'],
): IdeaFactorEmbedRow | null => {
  if (Array.isArray(ideaFactors)) {
    return ideaFactors[0] ?? null;
  }
  return ideaFactors;
};

const toSavedManualActivityRecord = (
  row: ActivityRecordRow,
  emissions: number | null = null,
): SavedManualActivityRecord => {
  const location = toLocationOptionRow(row.locations);
  const ideaFactor = toIdeaFactorEmbedRow(row.idea_factors);

  return {
    id: row.id,
    locationId: row.locationId,
    locationName: location?.name ?? '',
    energyType: row.energyType,
    amount: Number(row.amount),
    unit: row.unit,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    note: row.note,
    createdAt: row.createdAt,
    emissionFactorId: row.emissionFactorId,
    emissions,
    scope3CategoryId: row.scope3CategoryId ?? null,
    ideaFactorId: row.ideaFactorId ?? null,
    ideaProductName: ideaFactor?.productName ?? null,
  };
};

export const getManualEntryLocations = async (): Promise<ManualEntryLocationOption[]> => {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('locations')
    .select('id, name, region')
    .in('status', ['active', 'paused'])
    .order('createdAt', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    throw new Error('手動入力用の拠点取得に失敗しました');
  }

  return ((data ?? []) as ManualEntryLocationRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    region: row.region,
  }));
};

// 重複エラーは「どのレコードと重複したのか」が分からないと合算導線に進めないため、
// 拠点名を引き直して具体的なメッセージを組み立てる。重複が起きたときだけの追加1クエリ。
// 拠点名が取れなければ汎用メッセージへ落とす（メッセージ生成の失敗で保存エラーを覆い隠さない）。
const buildManualDuplicateMessage = async (
  supabase: SupabaseClient,
  input: ManualActivityRecordInput,
): Promise<string> => {
  const { data } = await supabase
    .from('locations')
    .select('name')
    .eq('id', input.locationId)
    .maybeSingle();

  return buildDuplicateActivityRecordMessage({
    locationName: (data as { name: string } | null)?.name ?? null,
    categoryLabel: MANUAL_ACTIVITY_CATEGORY_MAP[input.energyType]?.labelJP ?? null,
    periodLabel: formatDuplicatePeriodLabel(input.periodStart),
  });
};

export const addManualActivityRecord = async (
  input: ManualActivityRecordInput,
): Promise<SavedManualActivityRecord> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const isDuplicate = await hasDuplicateActivityRecord(supabase, organizationId, input);
  if (isDuplicate) {
    throw new Error(await buildManualDuplicateMessage(supabase, input));
  }

  const { data, error } = await supabase
    .from('activity_records')
    .insert({
      organizationId,
      locationId: input.locationId,
      sourceType: 'manual',
      energyType: input.energyType,
      amount: input.amount,
      unit: input.unit,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      note: input.note,
      // フォームで選択された係数。算定バッチはこの指定を優先順位より優先して適用する。
      emissionFactorId: input.emissionFactorId,
    })
    .select(ACTIVITY_RECORD_SELECT)
    .single();

  if (error || !data) {
    if (isDuplicateActivityRecordError(error)) {
      throw new Error(await buildManualDuplicateMessage(supabase, input));
    }
    throw new Error('活動量レコードの登録に失敗しました');
  }

  return toSavedManualActivityRecord(data as ActivityRecordRow);
};

// 活動量レコードIDごとの算定済み排出量（t-CO2e）を引く。
// emission_results は activityRecordId に一意制約があるため1レコード=最大1行。
// 未算定（行が無い）のレコードはマップに現れず、呼び出し側で null 扱いにする。
// ID リストは分割して問い合わせる（数百件を .in() に並べると URL が 414 URI Too Long になり、
// 入力履歴が丸ごと「取得に失敗」になる。拠点詳細の getEmissionResults と同じ対策）。
const getEmissionsByRecordId = async (
  supabase: SupabaseClient,
  recordIds: string[],
): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  if (recordIds.length === 0) {
    return map;
  }

  for (const idsChunk of chunk(recordIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllRows<{ activityRecordId: string; emissions: string | number }>(
      (from, to) =>
        supabase
          .from('emission_results')
          .select('activityRecordId, emissions')
          .in('activityRecordId', idsChunk)
          .order('id', { ascending: true })
          .range(from, to),
      '排出量の取得に失敗しました',
    );
    for (const row of rows) {
      map.set(row.activityRecordId, Number(row.emissions));
    }
  }
  return map;
};

// 入力履歴の活動量レコードを新しい順に取得する。
// 各レコードには算定済みの排出量（emission_results）を突き合わせて返す。
// PostgREST の max_rows（1000）で黙って切り詰められると、1001件目以降は最古のレコードから
// 順に履歴へ出なくなり、検索・編集・削除のどこからも到達できなくなる（DB には残る）。
// 月次×拠点×カテゴリの入力では数年で普通に到達する件数のため、fetchAllRows でページングして全行取得する。
// ページ境界で行が重複・欠落しないよう、createdAt の同値に備えて id で並び順を固定する。
export const getActivityHistoryRecords = async (): Promise<SavedManualActivityRecord[]> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const rows = await fetchAllRows<ActivityRecordRow>(
    (from, to) =>
      supabase
        .from('activity_records')
        .select(ACTIVITY_RECORD_SELECT)
        .eq('organizationId', organizationId)
        .order('createdAt', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    '入力履歴の取得に失敗しました',
  );
  const emissionsByRecordId = await getEmissionsByRecordId(
    supabase,
    rows.map((row) => row.id),
  );

  return rows.map((row) =>
    toSavedManualActivityRecord(row, emissionsByRecordId.get(row.id) ?? null),
  );
};

// 入力履歴のレコードを更新する。編集後は再算定が必要なため isCalculated=false へ戻す。
// 旧算定結果（emission_results）の削除は DB トリガー clear_emission_results_on_recalculation が
// この UPDATE と同じトランザクションで行う（別リクエストで削除していた頃は、削除だけ失敗すると
// レコードは更新済みなのにエラー表示になり、再算定までダッシュボードが旧値を計上し続けた）。
// 実際の再算定は呼び出し側が /api/calculations を叩いて行う。
export const updateManualActivityRecord = async (
  id: string,
  input: ManualActivityRecordInput,
): Promise<SavedManualActivityRecord> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  // RLS は自組織（profiles.organizationId）の行だけを見せる単一組織モデルだが、重複判定に使う
  // organizationId と対象レコードの所属が RLS 側の都合でずれないよう、ここでも明示的に絞って
  // 「自組織のレコードを自組織として更新する」ことをクエリ自体で担保する。
  const { data: currentRecord, error: currentRecordError } = await supabase
    .from('activity_records')
    .select('locationId, energyType, periodStart')
    .eq('id', id)
    .eq('organizationId', organizationId)
    .single();

  if (currentRecordError || !currentRecord) {
    throw new Error('活動量レコードの更新に失敗しました');
  }

  const duplicateKeyChanged =
    buildActivityRecordDuplicateKey(currentRecord as ActivityRecordDuplicateKeyRow) !==
    buildActivityRecordDuplicateKey(input);

  if (duplicateKeyChanged) {
    const isDuplicate = await hasDuplicateActivityRecord(supabase, organizationId, input, {
      excludeRecordId: id,
    });
    if (isDuplicate) {
      throw new Error(await buildManualDuplicateMessage(supabase, input));
    }
  }

  const { data, error } = await supabase
    .from('activity_records')
    .update({
      locationId: input.locationId,
      energyType: input.energyType,
      amount: input.amount,
      unit: input.unit,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      note: input.note,
      emissionFactorId: input.emissionFactorId,
      // 値が変わったので再算定対象へ戻す。
      isCalculated: false,
    })
    .eq('id', id)
    .eq('organizationId', organizationId)
    .select(ACTIVITY_RECORD_SELECT)
    .single();

  if (error || !data) {
    if (isDuplicateActivityRecordError(error)) {
      throw new Error(await buildManualDuplicateMessage(supabase, input));
    }
    throw new Error('活動量レコードの更新に失敗しました');
  }

  return toSavedManualActivityRecord(data as ActivityRecordRow);
};

// =========================================================================
// Scope3積上げ入力（IDEA連携。docs/idea-scope3-spec.md §5.2）
// =========================================================================

const SCOPE3_ENERGY_TYPE = 'scope3_activity' as const;

// Scope3積上げの重複キーは「拠点 × 'scope3_activity' × 対象月 × カテゴリ × IDEA製品」。
// energyType だけでは全 Scope3 レコードが同一カテゴリ扱いになり、推奨粒度
// 「月次 × 製品」の2製品目が登録できなくなるため、カテゴリ・製品まで含めて判定する
// （DB 側トリガー prevent_duplicate_activity_record（supabase/migrations/20260831000000_schema.sql）
// も同じキーで判定する。こちらは事前チェック）。
const hasDuplicateScope3ActivityRecord = async (
  supabase: SupabaseClient,
  organizationId: string,
  input: Scope3ActivityRecordInput,
  options: { excludeRecordId?: string } = {},
): Promise<boolean> => {
  let query = supabase
    .from('activity_records')
    .select('id')
    .eq('organizationId', organizationId)
    .eq('locationId', input.locationId)
    .eq('energyType', SCOPE3_ENERGY_TYPE)
    .eq('periodStart', input.periodStart)
    .eq('scope3CategoryId', input.scope3CategoryId)
    .eq('ideaFactorId', input.ideaFactorId);

  if (options.excludeRecordId) {
    query = query.neq('id', options.excludeRecordId);
  }

  const { data, error } = await query.limit(1);
  if (error) {
    throw new Error('活動量レコードの重複確認に失敗しました');
  }
  return (data ?? []).length > 0;
};

// 重複メッセージには拠点名・カテゴリ・製品名まで含め、どのレコードと重複したのか
// 特定できるようにする（buildManualDuplicateMessage と同じ方針。重複時のみの追加クエリ）。
const buildScope3DuplicateMessage = async (
  supabase: SupabaseClient,
  input: Scope3ActivityRecordInput,
): Promise<string> => {
  const [locationResult, factorResult] = await Promise.all([
    supabase.from('locations').select('name').eq('id', input.locationId).maybeSingle(),
    supabase.from('idea_factors').select('productName').eq('id', input.ideaFactorId).maybeSingle(),
  ]);

  const productName = (factorResult.data as { productName: string } | null)?.productName ?? null;
  const categoryLabel =
    `Scope3積上げ（カテゴリ${input.scope3CategoryId}）` +
    (productName ? `・製品「${productName}」` : '');

  return buildDuplicateActivityRecordMessage({
    locationName: (locationResult.data as { name: string } | null)?.name ?? null,
    categoryLabel,
    periodLabel: formatDuplicatePeriodLabel(input.periodStart),
  });
};

// Scope3積上げレコードを登録する。energyType='scope3_activity' 固定・emissionFactorId は
// 常に null（IDEA 係数は emission_factors に無い。算定は ideaFactorId の明示解決で行う）。
export const addScope3ActivityRecord = async (
  input: Scope3ActivityRecordInput,
): Promise<SavedManualActivityRecord> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const isDuplicate = await hasDuplicateScope3ActivityRecord(supabase, organizationId, input);
  if (isDuplicate) {
    throw new Error(await buildScope3DuplicateMessage(supabase, input));
  }

  const { data, error } = await supabase
    .from('activity_records')
    .insert({
      organizationId,
      locationId: input.locationId,
      sourceType: 'manual',
      energyType: SCOPE3_ENERGY_TYPE,
      amount: input.amount,
      unit: input.unit,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      note: input.note,
      emissionFactorId: null,
      scope3CategoryId: input.scope3CategoryId,
      ideaFactorId: input.ideaFactorId,
    })
    .select(ACTIVITY_RECORD_SELECT)
    .single();

  if (error || !data) {
    if (isDuplicateActivityRecordError(error)) {
      throw new Error(await buildScope3DuplicateMessage(supabase, input));
    }
    throw new Error('Scope3活動量レコードの登録に失敗しました');
  }

  return toSavedManualActivityRecord(data as ActivityRecordRow);
};

// Scope3積上げレコードを更新する。updateManualActivityRecord と同じく isCalculated=false へ戻し
// （旧算定結果は DB トリガーが同一トランザクションで削除）、実際の再算定は呼び出し側が /api/calculations を叩いて行う。
export const updateScope3ActivityRecord = async (
  id: string,
  input: Scope3ActivityRecordInput,
): Promise<SavedManualActivityRecord> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { data: currentRecord, error: currentRecordError } = await supabase
    .from('activity_records')
    .select('locationId, periodStart, scope3CategoryId, ideaFactorId')
    .eq('id', id)
    .eq('organizationId', organizationId)
    .eq('energyType', SCOPE3_ENERGY_TYPE)
    .single();

  if (currentRecordError || !currentRecord) {
    throw new Error('Scope3活動量レコードの更新に失敗しました');
  }

  const current = currentRecord as {
    locationId: string;
    periodStart: string;
    scope3CategoryId: number | null;
    ideaFactorId: string | null;
  };
  const duplicateKeyChanged =
    current.locationId !== input.locationId ||
    current.periodStart !== input.periodStart ||
    current.scope3CategoryId !== input.scope3CategoryId ||
    current.ideaFactorId !== input.ideaFactorId;

  if (duplicateKeyChanged) {
    const isDuplicate = await hasDuplicateScope3ActivityRecord(supabase, organizationId, input, {
      excludeRecordId: id,
    });
    if (isDuplicate) {
      throw new Error(await buildScope3DuplicateMessage(supabase, input));
    }
  }

  const { data, error } = await supabase
    .from('activity_records')
    .update({
      locationId: input.locationId,
      amount: input.amount,
      unit: input.unit,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      note: input.note,
      scope3CategoryId: input.scope3CategoryId,
      ideaFactorId: input.ideaFactorId,
      // 値が変わったので再算定対象へ戻す。
      isCalculated: false,
    })
    .eq('id', id)
    .eq('organizationId', organizationId)
    .eq('energyType', SCOPE3_ENERGY_TYPE)
    .select(ACTIVITY_RECORD_SELECT)
    .single();

  if (error || !data) {
    if (isDuplicateActivityRecordError(error)) {
      throw new Error(await buildScope3DuplicateMessage(supabase, input));
    }
    throw new Error('Scope3活動量レコードの更新に失敗しました');
  }

  return toSavedManualActivityRecord(data as ActivityRecordRow);
};

// 入力履歴のレコードを削除する。emission_results は activityRecordId の
// on delete cascade で自動削除される。再算定（集計の更新）は呼び出し側が行う。
export const deleteActivityRecord = async (id: string): Promise<void> => {
  const supabase = createClient();

  const { error } = await supabase.from('activity_records').delete().eq('id', id);
  if (error) {
    throw new Error('活動量レコードの削除に失敗しました');
  }
};
