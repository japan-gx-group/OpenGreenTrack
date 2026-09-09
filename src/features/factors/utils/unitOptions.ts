// エネルギー種別ごとの係数単位の候補（先頭 = 既定値）。
// 新規係数モーダルで種別を選ぶと先頭の単位が自動セットされ、プルダウンで他候補へ変更できる。
// 分母は算定エンジンの単位換算表（calculation/engine/units.ts）が扱える単位に揃えること。
import type { EnergyLabel } from '../services/factorService';

export const UNIT_OPTIONS_BY_ENERGY: Record<EnergyLabel, string[]> = {
  電気: ['t-CO2/kWh', 'kg-CO2e/kWh', 't-CO2e/kWh'],
  ガス: ['t-CO2/千m3', 't-CO2e/m3', 'kg-CO2e/m3'],
  熱: ['t-CO2/GJ', 'kg-CO2e/GJ'],
  A重油: ['t-CO2/kL', 't-CO2e/L', 'kg-CO2e/L'],
  軽油: ['t-CO2/kL', 't-CO2e/L', 'kg-CO2e/L'],
  ガソリン: ['t-CO2/kL', 't-CO2e/L', 'kg-CO2e/L'],
  灯油: ['t-CO2/kL', 't-CO2e/L', 'kg-CO2e/L'],
  原油: ['t-CO2/kL', 't-CO2e/L', 'kg-CO2e/L'],
  ナフサ: ['t-CO2/kL', 't-CO2e/L', 'kg-CO2e/L'],
  ジェット燃料油: ['t-CO2/kL', 't-CO2e/L', 'kg-CO2e/L'],
  LPG: ['t-CO2/t', 'kg-CO2e/kg'],
  LNG: ['t-CO2/t', 'kg-CO2e/kg'],
  天然ガス: ['t-CO2/千m3', 't-CO2e/m3'],
  石炭: ['t-CO2/t', 'kg-CO2e/kg'],
  '燃料（その他）': ['t-CO2/t', 't-CO2/kL', 't-CO2/千m3'],
  水道: ['t-CO2e/m3', 'kg-CO2e/m3'],
  輸送: ['t-CO2/t-km', 'kg-CO2e/t-km'],
  出張: ['kg-CO2/円', 'kg-CO2/泊', 't-CO2/人・日', 't-CO2/人・年', 't-CO2e/km'],
  通勤: ['kg-CO2/人・日', 'kg-CO2/円', 't-CO2e/km'],
  廃棄物: ['t-CO2/t', 'kg-CO2e/kg'],
  車両: ['t-CO2e/km', 'kg-CO2e/km'],
  物流: ['t-CO2/t-km', 'kg-CO2e/t-km'],
  '購入した製品・サービス': ['t-CO2e/円', 'kg-CO2e/円'],
  サプライヤーデータ: ['t-CO2e/t-CO2e'],
};

/** 種別の既定単位。候補が未定義の種別は空文字（自由入力にはしない）。 */
export const defaultUnitForEnergy = (energy: EnergyLabel): string =>
  UNIT_OPTIONS_BY_ENERGY[energy]?.[0] ?? '';

// 新規係数モーダルで種別を選んだときに係数値へ自動入力する「目安値」。
// 値は各種別の既定単位（UNIT_OPTIONS_BY_ENERGY の先頭）に対応する概算値で、
// 環境省・省エネ法の代表的な排出係数を基にしたおおよその出発点。あくまで入力の
// たたき台であり、正確な値は利用者が出典に基づき上書きする前提（要確認）。
export const DEFAULT_FACTOR_BY_ENERGY: Record<EnergyLabel, number> = {
  電気: 0.00045, // t-CO2/kWh
  ガス: 2.23, // t-CO2/千m3（都市ガス13A 相当）
  熱: 0.06, // t-CO2/GJ（産業用蒸気 相当）
  A重油: 2.71, // t-CO2/kL
  軽油: 2.58, // t-CO2/kL
  ガソリン: 2.32, // t-CO2/kL
  灯油: 2.49, // t-CO2/kL
  原油: 2.62, // t-CO2/kL
  ナフサ: 2.13, // t-CO2/kL
  ジェット燃料油: 2.46, // t-CO2/kL
  LPG: 3.0, // t-CO2/t
  LNG: 2.7, // t-CO2/t
  天然ガス: 2.16, // t-CO2/千m3
  石炭: 2.33, // t-CO2/t（一般炭 相当）
  '燃料（その他）': 2.5, // t-CO2/t（汎用の目安）
  水道: 0.00023, // t-CO2e/m3（上水道 相当）
  輸送: 0.0002, // t-CO2/t-km（トラック輸送の目安）
  出張: 0.0005, // kg-CO2/円（支出ベースの目安）
  通勤: 2.0, // kg-CO2/人・日（目安）
  廃棄物: 2.5, // t-CO2/t（品目により大きく異なるため目安）
  '購入した製品・サービス': 0.0005, // t-CO2e/円（支出ベースの目安）
  車両: 0.00015, // t-CO2e/km（目安）
  物流: 0.0002, // t-CO2/t-km（目安）
  サプライヤーデータ: 1.0, // t-CO2e/t-CO2e（等価）
};

/** 種別の目安係数値。未定義の種別は 0（利用者が入力）。 */
export const defaultFactorForEnergy = (energy: EnergyLabel): number =>
  DEFAULT_FACTOR_BY_ENERGY[energy] ?? 0;

/** 編集時など、現在値が候補に無い場合も選択肢に含める（値を壊さないため）。 */
export const unitOptionsFor = (energy: EnergyLabel, currentUnit: string): string[] => {
  const options = UNIT_OPTIONS_BY_ENERGY[energy] ?? [];
  return currentUnit && !options.includes(currentUnit) ? [currentUnit, ...options] : options;
};
