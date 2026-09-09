// 排出係数を「係数の性質」で 2 群に分ける。
//
// 「エネルギー種別」という 1 つの軸に、物理量ベースの燃料種係数（電気・ガス・重油…）と
// 活動量ベースの Scope 3 活動係数（水道・輸送・出張・購入した製品・サービス…）が
// 平置きされており、エネルギーでないものが「エネルギー種別」として表示されていた。
// 係数管理画面をこの 2 群のタブに分けることで、燃料側は「エネルギー種別」の表記が
// そのまま正確になり、Scope 3 側は「活動カテゴリ」と呼べる。
//
// 振り分けの根拠に `scope` 列を使わない理由:
//   - 燃料は Scope 3 カテゴリ3（Scope 1,2 に含まれない燃料及びエネルギー）にも現れ、
//     scope で切ると同じ「軽油」が 2 つのタブに分かれてしまう
//   - 逆に廃棄物・出張などの活動係数は scope1/2 で登録されることはない
// 分けたいのは「何を数えているか（物理量か活動量か）」であり、それはエネルギー種別
// そのものの性質なので、種別ラベルから決める。DB 変更は不要。
import type { EnergyLabel } from '../services/factorService';

export const FACTOR_GROUPS = ['fuel', 'activity'] as const;
export type FactorGroup = (typeof FACTOR_GROUPS)[number];

/** タブの見出し。 */
export const FACTOR_GROUP_LABELS: Record<FactorGroup, string> = {
  fuel: 'エネルギー・燃料係数',
  activity: 'Scope 3 活動係数',
};

/** タブの補足（何を数える係数の群なのか）。 */
export const FACTOR_GROUP_DESCRIPTIONS: Record<FactorGroup, string> = {
  fuel: '物理量（kWh・L・m³ 等）あたりの係数。主に Scope 1・2 の算定に使う。',
  activity: '活動量（円・t-km・人・日 等）あたりの係数。Scope 3 の算定に使う。',
};

/**
 * 種別を選ぶ軸の呼び名。群ごとに言い換えることで、エネルギーでないものを
 * 「エネルギー種別」と呼ばずに済ませる（この issue の主目的）。
 */
export const FACTOR_GROUP_ENERGY_FIELD_LABELS: Record<FactorGroup, string> = {
  fuel: 'エネルギー種別',
  activity: '活動カテゴリ',
};

/**
 * エネルギー種別ラベル → 群。EnergyLabel の全値を網羅する
 * （新しい種別を EnergyLabel に足したらここも足す。factorGroups.test.ts が網羅を検証する）。
 */
export const FACTOR_GROUP_BY_ENERGY: Record<EnergyLabel, FactorGroup> = {
  // 物理量ベースの燃料種係数（kWh・m³・L・kL・t・GJ）
  電気: 'fuel',
  ガス: 'fuel',
  熱: 'fuel',
  A重油: 'fuel',
  軽油: 'fuel',
  ガソリン: 'fuel',
  灯油: 'fuel',
  原油: 'fuel',
  ナフサ: 'fuel',
  ジェット燃料油: 'fuel',
  LPG: 'fuel',
  LNG: 'fuel',
  天然ガス: 'fuel',
  石炭: 'fuel',
  '燃料（その他）': 'fuel',
  // 活動量ベースの Scope 3 活動係数（m3・t-km・km・円・人・日・t-CO2e）
  水道: 'activity',
  輸送: 'activity',
  出張: 'activity',
  通勤: 'activity',
  廃棄物: 'activity',
  車両: 'activity',
  物流: 'activity',
  '購入した製品・サービス': 'activity',
  サプライヤーデータ: 'activity',
};

/** 係数（またはその種別ラベル）が属する群。未知のラベルは活動側に寄せる（燃料タブを汚さないため）。 */
export const factorGroupOf = (energyType: EnergyLabel): FactorGroup =>
  FACTOR_GROUP_BY_ENERGY[energyType] ?? 'activity';

/** 与えた種別ラベル一覧のうち、その群に属するものだけを元の順序で返す。 */
export const energyLabelsInGroup = (
  group: FactorGroup,
  labels: readonly EnergyLabel[],
): EnergyLabel[] => labels.filter((label) => factorGroupOf(label) === group);
