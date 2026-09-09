// 排出係数マスタ（emission_factors）で算定する Scope3 カテゴリの対応表（純関数・副作用なし）。
//
// 公式係数 seed（supabase/seeds/production/official_emission_factors.sql）には scope='scope3' の
// 標準係数（廃棄物・輸送トンキロ・出張・通勤）が入っており、データ入力フォームの「標準係数」群からも
// これらのカテゴリで活動量を登録できる。ところが emission_results に categoryId が無いと
// refresh_dashboard_aggregates（scope='scope3' かつ categoryId 1〜15 の行だけを積む）が黙って無視し、
// 算定済みなのにダッシュボードへ一切反映されない。energyType からカテゴリ番号を一意に引けるものは
// ここで固定し、computeEmissions が係数の scope が scope3 のときに結果へ載せる。
//
// IDEA 連携の Scope3 積上げ（energyType='scope3_activity'）はレコード側の scope3CategoryId が
// カテゴリを担う（toScope3Insert で詰め替える）ため、この表には載せない。

import type { EnergyType } from '../types';
import { scopeForEnergyTypeName } from './energyTypeScope';

/**
 * energyType → Scope3 カテゴリ番号（GHG プロトコルの 15 カテゴリ）。
 *   1: 購入した製品・サービス / 4: 輸送、配送（上流） / 5: 事業から出る廃棄物 / 6: 出張 / 7: 雇用者の通勤
 * 車両（vehicle）は自社保有車の燃料として Scope1 扱いのため載せない（係数側の scope が scope1）。
 * Scope1・2 の種別と scope3_activity を除く全種別がここに載っている必要がある
 * （energyTypeScope.ts で scope3 とした種別に番号が無いと、算定結果がどの集計にも載らない）。
 */
const SCOPE3_CATEGORY_BY_ENERGY_TYPE: Partial<Record<EnergyType, number>> = {
  purchased_goods_services: 1,
  supplier_data: 1,
  // 上水道の購入はカテゴリ1（購入した製品・サービス）。公式係数は無く自社設定の係数で算定する
  water: 1,
  freight_transport: 4,
  logistics: 4,
  waste: 5,
  business_travel: 6,
  business_travel_commuting: 7,
};

/** energyType に対応する Scope3 カテゴリ番号。対応が無い（Scope1/2 の種別・IDEA 積上げ）場合は null。 */
export const scope3CategoryIdForEnergyType = (energyType: EnergyType): number | null =>
  SCOPE3_CATEGORY_BY_ENERGY_TYPE[energyType] ?? null;

/**
 * その energyType の活動量が Scope 3 に属するか（レポートの範囲判定用）。
 * 判定は種別ごとの Scope の正本（energyTypeScope.ts）から引く。廃棄物・出張・通勤ほか上表の
 * 種別に加え、IDEA 積上げ（energyType='scope3_activity'。カテゴリはレコード側の
 * scope3CategoryId が担う）も真になる。
 * 未算定のレコードは適用係数が決まっていないため scope を持たず、energyType でしか
 * Scope を判別できない。算定済み/未算定をまたいで同じ範囲で数える必要のある箇所
 * （レポートのデータ充足状況）はこの判定を使う。
 */
export const isScope3EnergyType = (energyType: string): boolean =>
  scopeForEnergyTypeName(energyType) === 'scope3';
