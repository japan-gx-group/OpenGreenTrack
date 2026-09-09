// GHG自動算定エンジンのドメイン型。
// DBスキーマ（supabase/migrations/20260831000000_schema.sql）の
// camelCaseカラム名・enum値に合わせている。
// ※ 現時点では supabase gen types による自動生成型は導入せず、算定エンジンが
//   実際に触るカラムだけを最小の手書き型として定義する（将来自動生成に置換してよい）。

// --- DBと一致させる列挙型 ---

export const SCOPES = ['scope1', 'scope2', 'scope3'] as const;
export type Scope = typeof SCOPES[number];

export const ENERGY_TYPES = [
  'electricity',
  'city_gas',
  'fuel_heavy_oil',
  'fuel_diesel',
  'water',
  'waste',
  'fuel',
  'vehicle',
  'logistics',
  'business_travel_commuting',
  'purchased_goods_services',
  'supplier_data',
  'freight_transport',
  'business_travel',
  // 温対法「算定方法・排出係数一覧」の主要燃料
  'fuel_gasoline',
  'fuel_kerosene',
  'fuel_crude_oil',
  'fuel_naphtha',
  'fuel_jet',
  'fuel_lpg',
  'fuel_lng',
  'fuel_natural_gas',
  'fuel_coal',
  // 熱供給事業者からの温水・冷水・蒸気の供給（単位 GJ）
  'heat',
  // Scope3積上げ算定（IDEA連携）のレコード種別。カテゴリ識別は
  // activity_records.scope3CategoryId が担う（docs/idea-scope3-spec.md §3.5）。
  // 係数作成UI（Factors.client.tsx の energyTypeOptions）・係数CSVインポート
  // （factorService.ts の ENERGY_VALUE_BY_LABEL）の候補には載せないこと。
  'scope3_activity',
] as const;
export type EnergyType = typeof ENERGY_TYPES[number];

export const FACTOR_STATUSES = [
  'active',
  'pending_review',
  'draft',
  'archived',
] as const;
export type FactorStatus = typeof FACTOR_STATUSES[number];

// 事業者別排出係数の係数種別。basic=基礎排出係数 / adjusted=調整後排出係数。
// 区分を持たない係数（燃料・Scope3原単位・カスタム係数）は null。
export const FACTOR_TYPES = ['basic', 'adjusted'] as const;
export type FactorType = typeof FACTOR_TYPES[number];

// locations.region と emission_factors.regionName を突き合わせるための対応表。
// 標準係数の regionName は「全国」または地域名（日本語）で登録される想定。
export const REGION_NAME_NATIONWIDE = '全国';

// --- DB行の最小型（算定エンジンが読むカラムのみ） ---

/** activity_records（活動量レコード）の算定に必要なカラム */
export interface ActivityRecordRow {
  id: string;
  organizationId: string;
  locationId: string;
  energyType: EnergyType;
  /** 活動量（numeric(15,3)）。supabase-js からは string で返るため number へ正規化して渡す */
  amount: number;
  unit: string;
  periodStart: string; // ISO date (YYYY-MM-DD)
  periodEnd: string;
  isCalculated: boolean;
  /**
   * 手動入力などで明示選択された排出係数ID（nullable）。
   * 指定があり適用候補内にあれば、係数解決で優先順位より優先して使う。
   */
  emissionFactorId?: string | null;
  /**
   * Scope3積上げレコード（energyType='scope3_activity'）のカテゴリ（1〜15）。
   * 取得 select に含め忘れると undefined のまま categoryId=null で保存され、
   * §5.1 の calculated 集計が黙って 0 になる（docs/idea-scope3-spec.md §4.3-1）。
   */
  scope3CategoryId?: number | null;
  /**
   * 参照する IDEA 係数ID（idea_factors.id）。Scope3積上げレコードのみ非null。
   * null の Scope3 レコードは参照切れの孤児として SCOPE3_FACTOR_MISSING で未解決にする。
   */
  ideaFactorId?: string | null;
}

/** emission_factors（排出係数マスタ）の算定に必要なカラム */
export interface EmissionFactorRow {
  id: string;
  /** null = 公式係数（全組織共通の読み取り専用マスタ） */
  organizationId: string | null;
  name: string;
  energyType: EnergyType;
  scope: Scope;
  /** 係数値（numeric(12,6)）。number へ正規化して渡す */
  factorValue: number;
  unit: string;
  applicableYear: number;
  regionName: string;
  status: FactorStatus;
  isCustom: boolean;
  locationId: string | null;
  supplierId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** 供給事業者名。非null の係数は自動解決の対象外（明示選択専用） */
  providerName: string | null;
  /** 公表資料上の事業者登録番号（電気/ガス: A0002 等、熱: 006 等） */
  providerNumber: string | null;
  /** メニュー名・供給区域・地区名 */
  menuName: string | null;
  factorType: FactorType | null;
}

/** emission_results への挿入内容（純粋コアが生成する算定結果） */
export interface EmissionResultInsert {
  activityRecordId: string;
  /**
   * nullable へ変更（IDEA由来は null。emission_factors への FK のため、
   * 正規化行の id（= ideaFactorId）を入れると FK 違反で INSERT が全件ロールバックする。
   * サービス層で toScope3Insert により必ず詰め替える。§4.3-4）
   */
  emissionFactorId: string | null;
  /** 追加: IDEA由来のみセット（idea_factors への FK） */
  ideaFactorId?: string | null;
  locationId: string;
  scope: Scope;
  categoryId: number | null;
  /** 排出量 t-CO2e（numeric(15,6)、小数6桁に丸め済み） */
  emissions: number;
  /**
   * 適用係数のスナップショット（参照先の版更新・削除後も監査用に保持）。
   * IDEA 由来は idea_factors の版情報込み（toScope3Insert）、通常算定（computeEmissions）は
   * emission_factors の factorValue / unit / name をそのまま焼き付ける。
   * emissionFactorId は生きた行への参照でしかなく、公式係数 seed の再投入（upsert で factorValue を
   * 上書き）・カスタム係数の編集・削除（FK は on delete set null）で算定根拠が失われるため。
   * 列の導入前に算定された既存行は null のまま（遡及して埋めることはできない）。
   */
  appliedFactorValue?: number | null;
  appliedFactorUnit?: string | null;
  appliedFactorName?: string | null;
}

// --- IDEA 係数（Scope3積上げ算定）の最小型 ---

/**
 * idea_factors（IDEA係数）の算定に必要なカラム。
 * gwpValue / baseFlowAmount は無制約 numeric（原典精度保持）のため supabase-js からは
 * string で返り得る。正規化（normalizeIdeaFactor）の中で Number() へ変換する。
 */
export interface IdeaFactorRow {
  id: string;
  organizationId: string;
  importId: string;
  ideaCode: string;
  productName: string;
  baseFlowAmount: number | string;
  unit: string;
  gwpValue: number | string;
}

/** idea_imports（IDEAインポート記録）の算定に必要なカラム（appliedFactorName の版表記用） */
export interface IdeaImportRow {
  id: string;
  version: string;
}

// --- 純粋コアの入出力ドメイン型 ---

/** 活動量が算定できなかった理由 */
export type UnresolvedReason =
  | 'FACTOR_NOT_FOUND'
  // 同順位の標準係数が複数あり（例: fuel_heavy_oil の A重油 / B・C重油）、明示選択なしでは決められない
  | 'FACTOR_AMBIGUOUS'
  | 'UNIT_MISMATCH'
  // 係数の適用範囲（scope）がエネルギー種別から決まる Scope と食い違う（engine/energyTypeScope.ts）
  | 'FACTOR_SCOPE_MISMATCH'
  // 追加: Scope3積上げレコードの参照係数（ideaFactorId）が削除されている
  | 'SCOPE3_FACTOR_MISSING';

/**
 * 未算定理由のユーザー向け文言（データ入力画面の算定サマリで件数と一緒に出す）。
 * detail（レコード個別の補足）とは別に、理由ごとに「次に何をすればよいか」を伝える。
 */
export const UNRESOLVED_REASON_MESSAGES: Record<UnresolvedReason, string> = {
  FACTOR_NOT_FOUND: '適用できる排出係数が見つからず未算定のままです。',
  FACTOR_AMBIGUOUS:
    '該当する排出係数が複数あり自動では決められないため未算定のままです。入力履歴から該当レコードを開き、排出係数を選択して保存してください。',
  UNIT_MISMATCH: '活動量の単位を排出係数の単位に換算できないため未算定のままです。',
  FACTOR_SCOPE_MISMATCH:
    '適用される排出係数の適用範囲（Scope）がエネルギー種別と食い違うため未算定のままです。そのまま算定すると集計とデータ充足状況で別々のScopeに数えられるため、排出係数管理画面で該当の係数の適用範囲を直してください。',
  SCOPE3_FACTOR_MISSING: '参照していた IDEA 係数が削除されているため未算定のままです。製品を再選択してください。',
};

/** 未算定として残ったレコードの情報（ユーザーへ提示する） */
export interface UnresolvedRecord {
  activityRecordId: string;
  locationId: string;
  energyType: EnergyType;
  reason: UnresolvedReason;
  /** 補足メッセージ（例: 単位 kWh に対応する係数が無い 等） */
  detail: string;
}

/**
 * 算定はできたが、レコードの明示指定どおりの係数は使えなかったことを示す理由。
 * どちらも算定自体は成立するため unresolved には載らないが、値が出ているぶん気づきにくく、
 * 報告用途では「選んだ係数が使われなかった」ことを利用者へ必ず提示する。
 */
export type CalculationWarningReason =
  // 明示指定が前提フィルタを外れ、同一事業者・同一メニューの別年度行へ読み替えた
  | 'EXPLICIT_FACTOR_REMAPPED'
  // 明示指定が使えず（アーカイブ済み・年度更新等）、優先順位による自動解決へ切り替えた
  | 'EXPLICIT_FACTOR_FALLBACK';

/** 算定はできたが利用者へ知らせるべき事象（明示選択した係数が使われなかった等） */
export interface CalculationWarning {
  activityRecordId: string;
  locationId: string;
  energyType: EnergyType;
  reason: CalculationWarningReason;
  /** レコードに保存されていた明示選択の係数ID */
  requestedFactorId: string;
  /** 実際に算定へ使った係数ID */
  appliedFactorId: string;
  /** 補足メッセージ（画面表示用） */
  detail: string;
}

/** computeEmissions の戻り値。純粋（副作用なし）に算定結果・未解決・警告を返す */
export interface CalculationOutcome {
  results: EmissionResultInsert[];
  unresolved: UnresolvedRecord[];
  /** 算定はできたが指定どおりの係数を使わなかったレコード */
  warnings: CalculationWarning[];
}
