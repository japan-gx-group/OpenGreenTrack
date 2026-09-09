// 活動量の単位と排出係数の単位の整合チェック＋換算（純関数・副作用なし）。
// 機能仕様 §5.5: 単位換算はサーバー側で適用し、対応できない組み合わせは UNIT_MISMATCH とする。
//
// 排出係数の unit は「分子(t-CO2e) / 分母(活動量単位)」の形（例 "t-CO2e/kWh"）で登録される。
// 分子（排出量の単位）と分母（活動量の単位）の両方を検証・換算する:
//   - 分母: 活動量レコードの unit と同一次元か（kWh↔MWh 等は換算）
//   - 分子: t-CO2e へ揃える（kg-CO2e なら 0.001 倍。ここを見落とすと 1000倍 の誤りになる）
// 最終的な排出量は t-CO2e 単位で算出する。

/** 単位表記のゆらぎを正規化する（大小文字は kWh/MWh 区別のため保持） */
export const normalizeUnit = (unit: string): string =>
  unit
    .trim()
    .replace(/[³]/g, '3') // m³ → m3
    .replace(/㎥/g, 'm3')
    .replace(/^kl$/i, 'kL'); // 公表資料の "kl" 表記（tCO2/kl 等）を kL に揃える

/** 分母（活動量単位）→ { 次元, 基準単位への換算係数 } の対応表 */
const UNIT_TO_BASE: Record<string, { dimension: string; toBase: number }> = {
  // エネルギー（基準: kWh）
  kWh: { dimension: 'energy', toBase: 1 },
  MWh: { dimension: 'energy', toBase: 1_000 },
  GWh: { dimension: 'energy', toBase: 1_000_000 },
  // ガス等の気体体積（基準: m3）。千m3 はガス事業者別係数（t-CO2/千m3）の公表単位。
  m3: { dimension: 'volume_gas', toBase: 1 },
  Nm3: { dimension: 'volume_gas', toBase: 1 },
  千m3: { dimension: 'volume_gas', toBase: 1_000 },
  // 熱量（基準: GJ）。熱供給事業者別係数（t-CO2/GJ）と熱の活動量（GJ）用。
  GJ: { dimension: 'heat_energy', toBase: 1 },
  MJ: { dimension: 'heat_energy', toBase: 0.001 },
  // 液体燃料の体積（基準: L）
  L: { dimension: 'volume_liquid', toBase: 1 },
  kL: { dimension: 'volume_liquid', toBase: 1_000 },
  // 質量（基準: kg）。LPG/LNG/石炭など t-CO2e/t で登録された係数を kg 実績と突き合わせるため。
  kg: { dimension: 'mass', toBase: 1 },
  t: { dimension: 'mass', toBase: 1_000 },
};

/** 分子（排出量単位）→ t-CO2e への換算係数。ここに無い分子は換算不能とする。
 * 公式係数の CO2 表記（tCO2 / t-CO2 等）は CO2 のみを対象とした係数だが、
 * 本ツールでは CO2e への寄与 1:1 として扱う（他ガスの寄与は別途計上する前提）。 */
const NUMERATOR_TO_TONNES: Record<string, number> = {
  't-co2e': 1,
  'kg-co2e': 0.001,
  'g-co2e': 0.000001,
  't-co2': 1,
  'tco2': 1,
  'kg-co2': 0.001,
  'g-co2': 0.000001,
};

/** 排出係数の unit（"t-CO2e/kWh" 等）を分子・分母に分解する */
export const splitFactorUnit = (
  factorUnit: string,
): { numerator: string; denominator: string } | null => {
  const parts = factorUnit.split('/');
  if (parts.length < 2) {
    return null;
  }
  const denominator = normalizeUnit(parts[parts.length - 1]);
  const numerator = normalizeUnit(parts.slice(0, parts.length - 1).join('/'));
  if (!numerator || !denominator) {
    return null;
  }
  return { numerator, denominator };
};

/**
 * 活動量 × 係数 を t-CO2e で得るための換算係数を返す。
 *   emissions(t-CO2e) = 活動量 × conversion × factorValue
 * - 分母（活動量単位）が一致/同一次元で換算可能 かつ 分子が t-CO2e 系 のときのみ数値を返す
 * - それ以外（次元違い・未知の単位・分子が CO2e でない・係数が単位形式でない）は null（= UNIT_MISMATCH）
 */
export const resolveUnitConversion = (
  activityUnit: string,
  factorUnit: string,
): number | null => {
  const split = splitFactorUnit(factorUnit);
  if (!split) {
    return null;
  }

  // 分子: t-CO2e へ揃える係数
  const numeratorFactor = NUMERATOR_TO_TONNES[split.numerator.toLowerCase()];
  if (numeratorFactor === undefined) {
    return null;
  }

  // 分母: 活動量単位を係数の分母単位に合わせる係数
  const activity = normalizeUnit(activityUnit);
  let denominatorFactor: number;
  if (activity === split.denominator) {
    denominatorFactor = 1;
  } else {
    const activityInfo = UNIT_TO_BASE[activity];
    const factorInfo = UNIT_TO_BASE[split.denominator];
    if (!activityInfo || !factorInfo || activityInfo.dimension !== factorInfo.dimension) {
      return null;
    }
    denominatorFactor = activityInfo.toBase / factorInfo.toBase;
  }

  return denominatorFactor * numeratorFactor;
};
