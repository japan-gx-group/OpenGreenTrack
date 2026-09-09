// エネルギー種別 → Scope の対応表（純関数・副作用なし）。「その種別の活動量はどの Scope か」の正本。
//
// Scope を係数の入力欄として自由に選ばせてはならない。集計（refresh_dashboard_aggregates）は
// emission_results の scope と categoryId で積むのに対し、レポートのデータ充足状況は
// energyType から Scope を判定する（未算定レコードは適用係数が決まっておらず scope を持たないため）。
// 両者が食い違う係数を作れると、同じ算定結果が2つの基準で別々に数えられる:
//   - 対応表（scope3Category.ts）に無い種別へ scope3 の係数を作ると categoryId が決まらず、
//     算定結果はどの集計にも載らないまま充足状況では「算定済み・採用」と数えられる
//   - 逆に Scope3 の種別へ scope1/2 の係数を作ると、排出量は Scope1・2 の表に載るのに
//     充足状況からは外れ、「算定済みでも採用されない」件数に入る
// 係数フォーム・CSV 取込・保存直前の変換（factorService の toMutationRow）はこの表から Scope を
// 決め、算定エンジンは食い違う係数のレコードを未算定（FACTOR_SCOPE_MISMATCH）に留める。
//
// 値の出所は公式係数 seed（supabase/seeds/production/official_emission_factors.sql）の scope 列。
// 公式係数が無い種別は GHG プロトコルの区分に従う:
//   - 車両（vehicle）: 自社保有車の燃料のため Scope1
//   - 水道（water）: 上水道の購入のため Scope3 カテゴリ1（購入した製品・サービス）
//   - 物流・購入した製品・サービス・サプライヤーデータ: Scope3（カテゴリは scope3Category.ts）

import type { EnergyType, Scope } from '../types';

/**
 * エネルギー種別ごとの Scope。EnergyType の全値を網羅する
 * （新しい種別を EnergyType に足したらここも足す。energyTypeScope.test.ts が網羅を検証する）。
 */
export const SCOPE_BY_ENERGY_TYPE: Record<EnergyType, Scope> = {
  // Scope 2（他社から供給される電気・熱の使用）
  electricity: 'scope2',
  heat: 'scope2',
  // Scope 1（自社の燃料の燃焼。車両は自社保有車の燃料）
  city_gas: 'scope1',
  fuel: 'scope1',
  fuel_heavy_oil: 'scope1',
  fuel_diesel: 'scope1',
  fuel_gasoline: 'scope1',
  fuel_kerosene: 'scope1',
  fuel_crude_oil: 'scope1',
  fuel_naphtha: 'scope1',
  fuel_jet: 'scope1',
  fuel_lpg: 'scope1',
  fuel_lng: 'scope1',
  fuel_natural_gas: 'scope1',
  fuel_coal: 'scope1',
  vehicle: 'scope1',
  // Scope 3（カテゴリ番号は scope3Category.ts が持つ）
  water: 'scope3',
  waste: 'scope3',
  logistics: 'scope3',
  freight_transport: 'scope3',
  business_travel: 'scope3',
  business_travel_commuting: 'scope3',
  purchased_goods_services: 'scope3',
  supplier_data: 'scope3',
  // Scope3積上げ（IDEA連携）。カテゴリはレコード側の scope3CategoryId が担う
  scope3_activity: 'scope3',
};

/** エネルギー種別に対応する Scope。 */
export const scopeForEnergyType = (energyType: EnergyType): Scope => SCOPE_BY_ENERGY_TYPE[energyType];

/**
 * 未知の値を含み得る文字列（DB から読んだ energyType など）から Scope を引く。対応が無ければ null。
 * プロトタイプ由来のキー（'constructor' 等）を拾わないよう hasOwnProperty で判定する。
 */
export const scopeForEnergyTypeName = (energyType: string): Scope | null =>
  Object.prototype.hasOwnProperty.call(SCOPE_BY_ENERGY_TYPE, energyType)
    ? SCOPE_BY_ENERGY_TYPE[energyType as EnergyType]
    : null;
