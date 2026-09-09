import type { SupabaseClient } from '@supabase/supabase-js';
import { scopeForEnergyType } from '@/features/calculation/engine/energyTypeScope';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabaseRows';

export const ACTIVE_FACTOR_UNIQUE_ERROR_MESSAGE = '同条件の有効係数が既に存在します';

export type EnergyLabel =
  | '電気' | 'ガス' | '熱' | 'A重油' | '軽油' | '水道' | '輸送' | '出張'
  // 温対法「算定方法・排出係数一覧」の主要燃料
  | 'ガソリン' | '灯油' | '原油' | 'ナフサ' | 'ジェット燃料油' | 'LPG' | 'LNG' | '天然ガス' | '石炭'
  // 公式係数整備で追加した種別（燃料その他・Scope3原単位・手動入力カテゴリ）
  | '燃料（その他）' | '廃棄物' | '車両' | '物流' | '通勤' | '購入した製品・サービス' | 'サプライヤーデータ';

/** 係数種別（基礎/調整後）の表示ラベル。事業者別係数のみ設定される。 */
export type FactorTypeLabel = '基礎' | '調整後';

export type EmissionFactor = {
  id: string;
  name: string;
  energyType: EnergyLabel;
  scope: 'Scope 1' | 'Scope 2' | 'Scope 3';
  factorValue: number;
  unit: string;
  applicableYear: number;
  region: string;
  source: string;
  status: '有効' | '確認中' | '下書き' | 'アーカイブ済み';
  isCustom: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  updatedAt?: string;
  /** 出典となる公表資料名。標準係数のみ設定される。 */
  sourceDocument?: string;
  /** 出典資料の公開URL。標準係数のみ設定される。 */
  sourceUrl?: string;
  /** 供給事業者名。事業者別係数（電気・ガス・熱）のみ設定される。 */
  providerName?: string;
  /** 公表資料上の事業者登録番号。 */
  providerNumber?: string;
  /** メニュー名・供給区域・地区名。 */
  menuName?: string;
  /** 基礎/調整後の区分。事業者別係数のみ設定される。 */
  factorType?: FactorTypeLabel;
};

// DB の EnergyType enum にある 'scope3_activity'（Scope3積上げ）は意図的に含めない。
// IDEA 係数は emission_factors ではなく idea_factors で管理し、係数管理画面・係数CSVの
// エネルギー種別候補から除外する（ユーザー作成のカスタム係数が積上げレコードに
// 自動マッチする経路を塞ぐ。docs/idea-scope3-spec.md §3.5）。
type EnergyType =
  | 'electricity' | 'city_gas' | 'heat' | 'fuel_heavy_oil' | 'fuel_diesel' | 'water' | 'freight_transport' | 'business_travel'
  | 'fuel_gasoline' | 'fuel_kerosene' | 'fuel_crude_oil' | 'fuel_naphtha' | 'fuel_jet' | 'fuel_lpg' | 'fuel_lng' | 'fuel_natural_gas' | 'fuel_coal'
  | 'fuel' | 'waste' | 'vehicle' | 'logistics' | 'business_travel_commuting' | 'purchased_goods_services' | 'supplier_data';
type Scope = 'scope1' | 'scope2' | 'scope3';
type FactorSource = 'moe' | 'meti' | 'ketsoho' | 'utility' | 'custom';
type FactorStatus = 'active' | 'pending_review' | 'draft' | 'archived';
type FactorType = 'basic' | 'adjusted';

type EmissionFactorRow = {
  id: string;
  name: string;
  energyType: EnergyType;
  scope: Scope;
  factorValue: number | string;
  unit: string;
  applicableYear: number;
  regionName: string;
  source: FactorSource;
  status: FactorStatus;
  isCustom: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  updatedAt: string | null;
  sourceDocumentName: string | null;
  sourceUrl: string | null;
  providerName: string | null;
  providerNumber: string | null;
  menuName: string | null;
  factorType: FactorType | null;
};

const EMISSION_FACTOR_SELECT = 'id, name, energyType, scope, factorValue, unit, applicableYear, regionName, source, status, isCustom, effectiveFrom, effectiveTo, updatedAt, sourceDocumentName, sourceUrl, providerName, providerNumber, menuName, factorType';

// V-FAC-002 の部分ユニークインデックス名。正本は
// supabase/migrations/20260831000000_schema.sql の emission_factors_active_*_key_idx。
// 名前がずれると 23505 をユーザー向け文言へ変換できず汎用エラーになるため、
// factorService.test.ts でマイグレーションSQLとの一致を検証している。
export const ACTIVE_FACTOR_UNIQUE_INDEX_NAMES = [
  'emission_factors_active_custom_org_key_idx',
  'emission_factors_active_custom_location_key_idx',
  'emission_factors_active_official_utility_key_idx',
];

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
};

export const getEmissionFactorMutationErrorMessage = (
  error: SupabaseErrorLike,
  fallbackMessage: string,
): string => {
  const errorText = [error.message, error.details].filter(Boolean).join('\n');
  const isActiveFactorUniqueViolation =
    error.code === '23505' &&
    ACTIVE_FACTOR_UNIQUE_INDEX_NAMES.some(indexName => errorText.includes(indexName));

  return isActiveFactorUniqueViolation ? ACTIVE_FACTOR_UNIQUE_ERROR_MESSAGE : fallbackMessage;
};

const ENERGY_LABEL_BY_VALUE: Record<EnergyType, EmissionFactor['energyType']> = {
  electricity: '電気',
  city_gas: 'ガス',
  heat: '熱',
  fuel_heavy_oil: 'A重油',
  fuel_diesel: '軽油',
  water: '水道',
  freight_transport: '輸送',
  business_travel: '出張',
  fuel_gasoline: 'ガソリン',
  fuel_kerosene: '灯油',
  fuel_crude_oil: '原油',
  fuel_naphtha: 'ナフサ',
  fuel_jet: 'ジェット燃料油',
  fuel_lpg: 'LPG',
  fuel_lng: 'LNG',
  fuel_natural_gas: '天然ガス',
  fuel_coal: '石炭',
  fuel: '燃料（その他）',
  waste: '廃棄物',
  vehicle: '車両',
  logistics: '物流',
  business_travel_commuting: '通勤',
  purchased_goods_services: '購入した製品・サービス',
  supplier_data: 'サプライヤーデータ',
};

// CSVインポート（factorCsvImport.ts）でも「有効な日本語ラベルか」の判定に使うため export する。
export const ENERGY_VALUE_BY_LABEL: Record<EmissionFactor['energyType'], EnergyType> = {
  電気: 'electricity',
  ガス: 'city_gas',
  熱: 'heat',
  A重油: 'fuel_heavy_oil',
  軽油: 'fuel_diesel',
  水道: 'water',
  輸送: 'freight_transport',
  出張: 'business_travel',
  ガソリン: 'fuel_gasoline',
  灯油: 'fuel_kerosene',
  原油: 'fuel_crude_oil',
  ナフサ: 'fuel_naphtha',
  ジェット燃料油: 'fuel_jet',
  LPG: 'fuel_lpg',
  LNG: 'fuel_lng',
  天然ガス: 'fuel_natural_gas',
  石炭: 'fuel_coal',
  '燃料（その他）': 'fuel',
  廃棄物: 'waste',
  車両: 'vehicle',
  物流: 'logistics',
  通勤: 'business_travel_commuting',
  '購入した製品・サービス': 'purchased_goods_services',
  サプライヤーデータ: 'supplier_data',
};

const FACTOR_TYPE_LABEL_BY_VALUE: Record<FactorType, FactorTypeLabel> = {
  basic: '基礎',
  adjusted: '調整後',
};

const SCOPE_LABEL_BY_VALUE: Record<Scope, EmissionFactor['scope']> = {
  scope1: 'Scope 1',
  scope2: 'Scope 2',
  scope3: 'Scope 3',
};

// CSVインポート（factorCsvImport.ts）でも「有効な日本語ラベルか」の判定に使うため export する。
export const SCOPE_VALUE_BY_LABEL: Record<EmissionFactor['scope'], Scope> = {
  'Scope 1': 'scope1',
  'Scope 2': 'scope2',
  'Scope 3': 'scope3',
};

/**
 * エネルギー種別から決まる適用範囲（Scope）の表示ラベル。
 * Scope は入力値ではなく種別から一意に決まる（calculation/engine/energyTypeScope.ts）。
 * 係数フォームの表示・CSV取込の検証・保存直前の変換（toMutationRow）はすべてここを通す。
 */
export const scopeLabelForEnergyLabel = (
  energyType: EmissionFactor['energyType'],
): EmissionFactor['scope'] =>
  SCOPE_LABEL_BY_VALUE[scopeForEnergyType(ENERGY_VALUE_BY_LABEL[energyType])];

const SOURCE_LABEL_BY_VALUE: Record<FactorSource, string> = {
  moe: '環境省',
  meti: '経済産業省',
  ketsoho: '温対法',
  utility: '事業者別排出係数',
  custom: '自社設定',
};

const SOURCE_VALUE_BY_LABEL: Record<string, FactorSource> = {
  環境省: 'moe',
  経済産業省: 'meti',
  温対法: 'ketsoho',
  事業者別排出係数: 'utility',
  自社設定: 'custom',
};

const STATUS_LABEL_BY_VALUE: Record<FactorStatus, EmissionFactor['status']> = {
  active: '有効',
  pending_review: '確認中',
  draft: '下書き',
  archived: 'アーカイブ済み',
};

// CSVインポート（factorCsvImport.ts）でも「有効な日本語ラベルか」の判定に使うため export する。
export const STATUS_VALUE_BY_LABEL: Record<EmissionFactor['status'], FactorStatus> = {
  有効: 'active',
  確認中: 'pending_review',
  下書き: 'draft',
  アーカイブ済み: 'archived',
};

const toNumber = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toEmissionFactor = (row: EmissionFactorRow): EmissionFactor => ({
  id: row.id,
  name: row.name,
  energyType: ENERGY_LABEL_BY_VALUE[row.energyType],
  scope: SCOPE_LABEL_BY_VALUE[row.scope],
  factorValue: toNumber(row.factorValue),
  unit: row.unit,
  applicableYear: row.applicableYear,
  region: row.regionName,
  source: SOURCE_LABEL_BY_VALUE[row.source],
  status: STATUS_LABEL_BY_VALUE[row.status],
  isCustom: row.isCustom,
  effectiveFrom: row.effectiveFrom ?? undefined,
  effectiveTo: row.effectiveTo ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
  sourceDocument: row.sourceDocumentName ?? undefined,
  sourceUrl: row.sourceUrl ?? undefined,
  providerName: row.providerName ?? undefined,
  providerNumber: row.providerNumber ?? undefined,
  menuName: row.menuName ?? undefined,
  factorType: row.factorType ? FACTOR_TYPE_LABEL_BY_VALUE[row.factorType] : undefined,
});

// CSV インポートのステータス列を保存するため export する（factorService.test.ts で検証）。
export const toMutationRow = (factor: Omit<EmissionFactor, 'id'>) => ({
  name: factor.name,
  energyType: ENERGY_VALUE_BY_LABEL[factor.energyType],
  // Scope は渡された値ではなくエネルギー種別から決める（多層防御）。食い違う組み合わせを
  // 保存できると、算定結果が集計とデータ充足状況で別々の Scope に数えられる。
  scope: SCOPE_VALUE_BY_LABEL[scopeLabelForEnergyLabel(factor.energyType)],
  factorValue: factor.factorValue,
  unit: factor.unit,
  applicableYear: factor.applicableYear,
  regionName: factor.region,
  source: factor.isCustom ? 'custom' : SOURCE_VALUE_BY_LABEL[factor.source] ?? 'custom',
  // 画面登録のカスタム係数は承認フローを設けず常に有効として保存する（初期ステータス欄は廃止）。
  // その既定は呼び出し側（Factors.client.tsx の factorForm が status='有効' を渡す）で担い、ここで 'active' に
  // 固定はしない: CSV インポート（factorCsvImport.ts）は「ステータス」列を検証したうえで渡してくるため、
  // 固定すると「下書き」「確認中」で取り込んだ行が黙って有効になり、算定に即座に使われてしまう。
  status: STATUS_VALUE_BY_LABEL[factor.status] ?? 'active',
  isCustom: factor.isCustom,
  effectiveFrom: factor.effectiveFrom ?? null,
  effectiveTo: factor.effectiveTo ?? null,
  sourceDocumentName: factor.sourceDocument ?? null,
  sourceUrl: factor.sourceUrl ?? null,
});

/**
 * 既存係数を編集フォームの初期値へ載せ替える。
 *
 * toMutationRow は「渡された値がすべて」として UPDATE 文を組み立て、欠けている列は null を書く。
 * そのためフォームの初期値からこぼれた列は、編集して保存した時点で黙って消える
 * （実際に出典資料名・出典URLが消えていた。CSV 取込でしか入らない列のため画面から入れ直せない）。
 * 列の載せ替えをこの 1 関数に集約し、EmissionFactor に列を足したらここも直す、という形にしておく。
 */
export const toFactorFormValues = (factor: EmissionFactor): Omit<EmissionFactor, 'id'> => ({
  name: factor.name,
  energyType: factor.energyType,
  scope: factor.scope,
  factorValue: factor.factorValue,
  unit: factor.unit,
  applicableYear: factor.applicableYear,
  region: factor.region,
  source: factor.source,
  status: factor.status,
  isCustom: factor.isCustom,
  effectiveFrom: factor.effectiveFrom,
  effectiveTo: factor.effectiveTo,
  sourceDocument: factor.sourceDocument,
  sourceUrl: factor.sourceUrl,
});

const toInsertRow = (factor: Omit<EmissionFactor, 'id'>, organizationId: string) => ({
  organizationId,
  ...toMutationRow({ ...factor, isCustom: true }),
});

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

  return data.organizationId as string;
};

export const getEmissionFactors = async (): Promise<EmissionFactor[]> => {
  const supabase = createClient();
  // 公式係数の投入で係数は数千件になり、PostgREST の max_rows(1000) で黙って切り詰められると
  // 一覧が電気事業者別係数だけになり出典別の件数も欠落するため、fetchAllRows で全行取得する。
  const rows = await fetchAllRows<EmissionFactorRow>(
    (from, to) =>
      supabase
        .from('emission_factors')
        .select(EMISSION_FACTOR_SELECT)
        .neq('status', 'archived')
        .order('applicableYear', { ascending: false })
        .order('createdAt', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    '排出係数の取得に失敗しました',
  );

  return rows.map(toEmissionFactor);
};

export const addEmissionFactor = async (
  factor: Omit<EmissionFactor, 'id'>,
): Promise<EmissionFactor> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { data, error } = await supabase
    .from('emission_factors')
    .insert(toInsertRow(factor, organizationId))
    .select(EMISSION_FACTOR_SELECT)
    .single();

  if (error) {
    throw new Error(getEmissionFactorMutationErrorMessage(error, '排出係数の登録に失敗しました'));
  }

  return toEmissionFactor(data as EmissionFactorRow);
};

export const updateEmissionFactor = async (
  id: string,
  factor: Omit<EmissionFactor, 'id'>,
): Promise<EmissionFactor> => {
  // 組織スコープは RLS が担保するため、ここでは対象を「自組織のカスタム係数」に絞る isCustom 条件だけ付ける。
  const supabase = createClient();

  const { data, error } = await supabase
    .from('emission_factors')
    .update(toMutationRow(factor))
    .eq('id', id)
    .eq('isCustom', true)
    .select(EMISSION_FACTOR_SELECT)
    .single();

  if (error) {
    // PGRST116 = 該当行なし（標準係数 or 他組織）。それ以外は通信・DB障害として区別する。
    if (error.code === 'PGRST116') {
      throw new Error('標準係数は画面から直接更新できません。カスタム係数のみ編集できます');
    }
    throw new Error(getEmissionFactorMutationErrorMessage(error, '排出係数の更新に失敗しました'));
  }

  return toEmissionFactor(data as EmissionFactorRow);
};

export const deleteEmissionFactor = async (id: string): Promise<void> => {
  // 組織スコープは RLS が担保するため、ここでは isCustom 条件だけ付ける。
  const supabase = createClient();
  const { error } = await supabase
    .from('emission_factors')
    .delete()
    .eq('id', id)
    .eq('isCustom', true)
    .select('id')
    .single();

  if (error) {
    // PGRST116 = 該当行なし（標準係数 or 他組織）。それ以外は通信・DB障害として区別する。
    if (error.code === 'PGRST116') {
      throw new Error('標準係数は画面から直接削除できません。カスタム係数のみ削除できます');
    }
    throw new Error('排出係数の削除に失敗しました');
  }
};
