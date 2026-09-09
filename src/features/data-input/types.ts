// データ入力機能で扱う活動量カテゴリと画面表示用メタデータ。
// DB の EnergyType enum 全値にラベルを用意し、手動入力で選べるカテゴリは別途限定する。
import type { EnergyType } from '@/features/calculation/types';
import type { Region } from '@/types/region';

// 公式係数が 1 件も無く、選んで入力しても未算定のままになる 4 種
// （vehicle / logistics / purchased_goods_services / supplier_data）は選択肢から外す。
// 物流・購入した製品・サービスは IDEA 原単位（Scope 3 積上げ）から入力し、車両は燃料（L）で入力する
// （距離ベースの推計は燃料との二重計上の入口になる）。ラベルは下の MAP に残し、既存レコードは履歴で表示し続ける。
export const MANUAL_ACTIVITY_CATEGORIES = [
  'electricity',
  'city_gas',
  'heat',
  'waste',
  'fuel',
  // 出張（カテゴリ6）と通勤（カテゴリ7）は別カテゴリ。1 本の「出張・通勤」にまとめると係数候補が
  // energyType 完全一致で通勤 10 件だけになり、出張の代表原単位 12 件が新規入力から到達不能になる。
  'business_travel',
  'business_travel_commuting',
] as const;

export type ManualActivityCategory = typeof MANUAL_ACTIVITY_CATEGORIES[number];

export const MANUAL_ACTIVITY_CATEGORY_MAP: Record<
  EnergyType,
  {
    labelJP: string;
    unit: string;
    /** 活動量の数え方の補足（単位だけでは何を入力するか伝わらないカテゴリのみ）。入力欄の直下に表示する。 */
    amountGuide?: string;
  }
> = {
  electricity: { labelJP: '電気', unit: 'kWh' },
  city_gas: { labelJP: 'ガス', unit: 'm³' },
  heat: { labelJP: '熱（温水・冷水・蒸気）', unit: 'GJ' },
  waste: { labelJP: '廃棄物', unit: 't' },
  fuel: { labelJP: '燃料', unit: 'L' },
  // 公式係数が無いため手動入力の選択肢外。既存レコードの履歴表示・排出係数管理の種別表示用にラベルを残す。
  vehicle: { labelJP: '車両', unit: 'km' },
  logistics: { labelJP: '物流', unit: 't-km' },
  // 公式係数（環境省 DB カテゴリ7 通勤）はすべて kg-CO2/人・日 のため、距離（km）ではなく
  // 延べ人日を入力させる。km を単位にすると公式係数へ換算できず、恒久的に UNIT_MISMATCH で
  // 未算定になる。
  business_travel_commuting: {
    labelJP: '通勤',
    unit: '人・日',
    amountGuide:
      '通勤した延べ人数×日数を入力します（例: 従業員10人が月20日通勤 → 200 人・日）。',
  },
  // 公式係数（環境省 DB カテゴリ6 出張）は 延べ出張日数当たり（t-CO2/人・日）のほか、交通費支給額
  // 当たり（kg-CO2/円）・宿泊数当たり（kg-CO2/泊）・従業員当たり（t-CO2/人・年）がある。標準単位は
  // 通勤と同じ延べ人日にし、円 / 泊 / 人・年 の係数を選んだときは入力フォームが係数の分母単位へ
  // 切り替える（resolveEntryUnit）。
  business_travel: {
    labelJP: '出張',
    unit: '人・日',
    amountGuide:
      '出張した延べ人数×日数を入力します（例: 従業員5人が各3日出張 → 15 人・日）。交通費支給額（円）・宿泊数（泊）・従業員数（人・年）で算定する場合は、排出係数で該当する原単位を選ぶと単位が切り替わります。',
  },
  // 同上（手動入力の選択肢外。Scope 3 カテゴリ1 は IDEA 原単位から入力する）。
  purchased_goods_services: { labelJP: '購入した製品・サービス', unit: '円' },
  supplier_data: { labelJP: 'サプライヤーデータ', unit: 't-CO2e' },
  // 既存/インポート済みレコードは選択肢に出さないが、履歴で表示し続ける。
  fuel_heavy_oil: { labelJP: '重油', unit: 'L' },
  fuel_diesel: { labelJP: '軽油', unit: 'L' },
  water: { labelJP: '水道', unit: 'm3' },
  // 輸送も手動入力の選択肢外だが履歴表示のためラベルを用意する。
  freight_transport: { labelJP: '輸送', unit: 't-km' },
  // 温対法「算定方法・排出係数一覧」の主要燃料。
  // 手動入力の選択肢外だが、履歴表示のためラベルを用意する。
  fuel_gasoline: { labelJP: 'ガソリン', unit: 'L' },
  fuel_kerosene: { labelJP: '灯油', unit: 'L' },
  fuel_crude_oil: { labelJP: '原油', unit: 'L' },
  fuel_naphtha: { labelJP: 'ナフサ', unit: 'L' },
  fuel_jet: { labelJP: 'ジェット燃料油', unit: 'L' },
  fuel_lpg: { labelJP: 'LPG', unit: 't' },
  fuel_lng: { labelJP: 'LNG', unit: 't' },
  fuel_natural_gas: { labelJP: '天然ガス', unit: 'm³' },
  fuel_coal: { labelJP: '石炭', unit: 't' },
  // Scope3積上げ（IDEA連携）。手動入力カテゴリ定数の選択肢外
  // （統合データ入力フォームでは「IDEA 原単位」の群としてカテゴリ 1〜15 を選ぶ）。
  // 実際の単位は選択した IDEA 製品から自動設定される（kg / kWh / 円 / t-km 等）ため、
  // ここの unit は履歴表示のフォールバック用の既定値。
  scope3_activity: { labelJP: 'Scope3積上げ', unit: 'kg' },
};

export interface ManualEntryLocationOption {
  id: string;
  name: string;
  /** 拠点の地域。地域一致の標準係数（優先度レベル4）の解決に使う。 */
  region: Region;
}

export interface ManualActivityRecordInput {
  locationId: string;
  // 新規入力では手動カテゴリのみ選ぶが、履歴編集では取込レコード（燃料種別など手動カテゴリ外）も
  // 対象になるため EnergyType 全体を許容する。
  energyType: EnergyType;
  amount: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  /** フォームで選択した排出係数ID。null なら算定時に自動解決する。 */
  emissionFactorId: string | null;
}

/**
 * Scope3積上げ入力（IDEA連携）の保存内容。
 * energyType は常に 'scope3_activity'、emissionFactorId は常に null（IDEA 係数は
 * emission_factors に存在しないため。算定は ideaFactorId の明示解決で行う）を
 * サービス側で固定するため、このインターフェースには含めない。
 */
export interface Scope3ActivityRecordInput {
  locationId: string;
  /** Scope3 カテゴリ（1〜15） */
  scope3CategoryId: number;
  /** 選択した IDEA 製品（idea_factors.id） */
  ideaFactorId: string;
  amount: number;
  /** 選択製品の unit（自動設定・編集不可。算定時の単位換算は常に 1:1 になる） */
  unit: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
}

/**
 * 統合データ入力フォーム（ActivityEntryForm）の保存内容。
 * Scope1/2（emission_factors 参照）と Scope3積上げ（IDEA 参照）はサービスの保存経路が
 * 異なる（add/updateManualActivityRecord と add/updateScope3ActivityRecord）ため、
 * フォームは判別共用体で 1 本の onSave に渡し、呼び出し側（DataInput）が振り分ける。
 */
export type ActivityEntryInput =
  | { kind: 'scope12'; input: ManualActivityRecordInput }
  | { kind: 'scope3'; input: Scope3ActivityRecordInput };

/**
 * 統合データ入力フォームの履歴編集で使う初期値。新規入力（create）では未指定。
 * kind（保存経路）は編集中に変更できない（サービスに Scope1/2 ⇄ Scope3 をまたぐ更新経路が無いため）。
 */
export type ActivityEntryInitialValues =
  | {
      kind: 'scope12';
      locationId: string;
      /** 登録時の拠点名（拠点が稼働中・一時停止でなくなり選択肢に無いときの案内に使う） */
      locationName: string;
      energyType: EnergyType;
      /**
       * 保存済み activity_records.unit をそのまま渡す。過去に登録したレコードは
       * 標準単位と異なる単位（MWh / kL / 千m3 / 円 など）を持ち得るため、編集で
       * カテゴリを変えない限りこの単位を保持して保存する（標準単位で上書きすると誤算定になる）。
       */
      unit: string;
      /** 対象年月（'YYYY-MM'） */
      targetMonth: string;
      amount: string;
      note: string;
      emissionFactorId: string | null;
    }
  | {
      kind: 'scope3';
      locationId: string;
      /** 登録時の拠点名（拠点が稼働中・一時停止でなくなり選択肢に無いときの案内に使う） */
      locationName: string;
      scope3CategoryId: number;
      /** 参照切れ（孤児）レコードは null。編集時に製品の再選択を促す。 */
      ideaFactorId: string | null;
      /** 対象年月（'YYYY-MM'） */
      targetMonth: string;
      amount: string;
      note: string;
    };

export interface SavedManualActivityRecord {
  id: string;
  locationId: string;
  locationName: string;
  energyType: EnergyType;
  amount: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  createdAt: string;
  /** 履歴編集で係数を初期選択するために保持する。未指定なら null（算定時に自動解決）。 */
  emissionFactorId: string | null;
  /** 算定済みの排出量（t-CO2e）。未算定（emission_results が無い）の場合は null。 */
  emissions: number | null;
  /** Scope3積上げレコードのカテゴリ（1〜15）。それ以外のレコードは null。 */
  scope3CategoryId: number | null;
  /** 参照する IDEA 製品（idea_factors.id）。参照切れ・Scope3以外は null。 */
  ideaFactorId: string | null;
  /** 参照する IDEA 製品名（履歴表示用）。参照切れ・Scope3以外は null。 */
  ideaProductName: string | null;
}
