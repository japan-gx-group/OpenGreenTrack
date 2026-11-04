// TNFD 開示レポート R1 の指標マスター: コア指標の候補一覧と、R1 で入力欄を出すかの印（docs/tnfd-spec.md §8.1・別表B）。
//
// ⚠️ 暫定版。tnfdCode と分類は PL の整理で、Recommendations of the TNFD, October 2026 で確定したコード
// （C4.0 侵略的外来種 / C5.0 生態系の範囲 / C5.1 生態系の状態 / C5.2 種の絶滅リスク ほか）と突き合わせてから確定する。
// enabledInR1 は専門家（生物多様性）の選定で確定する（画面レビューの段階でよい。印を切り替えるだけで構造は変わらない）。
// enabledInR1 = false の指標もマスターから消さない（プレビュー・CSV は「R1 では対象外」と名前だけ出す）。
//
// GHG は OGT の採用値（SSBJ の OgtCandidateValue / OgtAdoptedValue）で扱い、ここでは表示上の指標 ID だけを持つ。

import type { TnfdMetricCategory, TnfdMetricDefinition, TnfdMetricId } from '../types';

/** マスターの版。ID・分類・コードを変えたら上げる（保存版にどの版のマスターで作ったかを残すため）。 */
export const TNFD_METRIC_MASTER_VERSION = 'r1-provisional-1';

/** GHG（OGT の採用値）の表示上の指標 ID。SSBJ の OgtScope2BasisTotals の各値に対応する。 */
export const TNFD_GHG_METRIC_IDS = {
  scope1: 'ghg_scope1',
  scope2: 'ghg_scope2',
  scope2LocationBased: 'ghg_scope2_location_based',
  scope2MarketBased: 'ghg_scope2_market_based',
  scope2MarketContract: 'ghg_scope2_market_contract',
  scope3: 'ghg_scope3',
} as const;

const ghg = (id: TnfdMetricId, label: string, guide: string): TnfdMetricDefinition => ({
  id,
  tnfdCode: 'C2.0',
  category: 'climate_change',
  label,
  unit: 't-CO2e',
  unitSelectable: false,
  inputKind: 'auto',
  enabledInR1: true,
  guide,
  requirementIds: ['REQ-TNFD-013'],
});

export const TNFD_METRICS: readonly TnfdMetricDefinition[] = [
  // ---- 気候変動（OGT の採用値。確定） ----
  ghg(TNFD_GHG_METRIC_IDS.scope1, 'GHG 排出量 Scope 1', 'OGT の算定結果を採用する。手で書き写さない。'),
  ghg(
    TNFD_GHG_METRIC_IDS.scope2,
    'GHG 排出量 Scope 2（基準の区別なし）',
    '温対法の係数区分（基礎／調整後）に基づく OGT の単一の合計。GHG プロトコルのロケーション基準・マーケット基準とは定義が異なる旨を注記に出す。',
  ),
  ghg(
    TNFD_GHG_METRIC_IDS.scope2LocationBased,
    'GHG 排出量 Scope 2（ロケーション基準）',
    '年度内の全 Scope 2 明細に基準別の行が揃ったときだけ値が入る。揃っていなければ未算定（0 にしない）。',
  ),
  ghg(
    TNFD_GHG_METRIC_IDS.scope2MarketBased,
    'GHG 排出量 Scope 2（マーケット基準）',
    '契約したメニューの係数で算定した分と、契約情報が無く標準係数で補った分の合計。補った分がある旨を注記に出す。',
  ),
  ghg(
    TNFD_GHG_METRIC_IDS.scope2MarketContract,
    'GHG 排出量 Scope 2（マーケット基準のうち契約根拠分）',
    'マーケット基準のうち、選んだ電気事業者のメニュー別係数で算定した分。',
  ),
  ghg(TNFD_GHG_METRIC_IDS.scope3, 'GHG 排出量 Scope 3', 'OGT の算定結果（カテゴリごとに採用した方式の値の合計）を採用する。'),
  // ---- 陸・淡水・海洋の利用変化 ----
  {
    id: 'spatial_footprint',
    tnfdCode: 'C1.0',
    category: 'land_freshwater_ocean_use_change',
    label: '総空間フットプリント',
    unit: 'km²',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '事業が占有・管理する土地・淡水・海洋の面積。',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'land_use_change',
    tnfdCode: 'C1.1',
    category: 'land_freshwater_ocean_use_change',
    label: '利用変化した面積（生態系タイプ別）',
    unit: 'km²',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '対象年度に利用を変えた面積。R1 では生態系タイプ別の内訳は持たず、合計と補足文で受ける。',
    requirementIds: ['REQ-TNFD-013'],
  },
  // ---- 汚染 ----
  {
    id: 'pollutants_soil',
    tnfdCode: null,
    category: 'pollution',
    label: '土壌に排出された汚染物質',
    unit: 't',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: 'TNFD 2026 Status Report で最も報告が難しいとされる指標。把握していなければ未入力のままにする。',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'wastewater',
    tnfdCode: null,
    category: 'pollution',
    label: '排水量',
    unit: 'm³',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '対象年度の排水の量。水質の指標は補足文で受ける。',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'waste',
    tnfdCode: null,
    category: 'pollution',
    label: '廃棄物の発生量・処分量',
    unit: 't',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '発生量と処分方法別の内訳は補足文で受ける。',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'plastic',
    tnfdCode: null,
    category: 'pollution',
    label: 'プラスチックの使用量・排出量',
    unit: 't',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'air_pollutants_non_ghg',
    tnfdCode: null,
    category: 'pollution',
    label: '非 GHG 大気汚染物質',
    unit: 't',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: 'TNFD 2026 Status Report で最も報告が難しいとされる指標。',
    requirementIds: ['REQ-TNFD-013'],
  },
  // ---- 資源利用 ----
  {
    id: 'water_withdrawal',
    tnfdCode: null,
    category: 'resource_use',
    label: '取水量',
    unit: 'm³',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: 'OGT の水道の活動量を参考にしてよいが、自動では転記しない（取水源の区別が無いため）。',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'water_consumption',
    tnfdCode: null,
    category: 'resource_use',
    label: '水消費量',
    unit: 'm³',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'water_stress_withdrawal',
    tnfdCode: null,
    category: 'resource_use',
    label: '水ストレス地域での取水・消費量',
    unit: 'm³',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '水ストレス地域の判定は R1 では自動化しない。判定の根拠を補足文に書く。',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'high_risk_commodities',
    tnfdCode: null,
    category: 'resource_use',
    label: '高リスク天然コモディティの調達量',
    unit: 't',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '対象とする品目の定義を補足文に書く。',
    requirementIds: ['REQ-TNFD-013'],
  },
  // ---- 侵略的外来種（October 2026 版で確定） ----
  {
    id: 'invasive_species',
    tnfdCode: 'C4.0',
    category: 'invasive_species',
    label: '侵略的外来種',
    unit: null,
    unitSelectable: false,
    inputKind: 'manual_text',
    enabledInR1: false,
    guide: '侵入リスクへの対応を文章で書く。',
    requirementIds: ['REQ-TNFD-013'],
  },
  // ---- 自然の状態（October 2026 版で確定） ----
  {
    id: 'ecosystem_extent',
    tnfdCode: 'C5.0',
    category: 'state_of_nature',
    label: '生態系の範囲',
    unit: 'km²',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: false,
    guide: '',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'ecosystem_condition',
    tnfdCode: 'C5.1',
    category: 'state_of_nature',
    label: '生態系の状態',
    unit: null,
    unitSelectable: false,
    inputKind: 'manual_text',
    enabledInR1: false,
    guide: '指標化の方法は LEAP v2.0 の自然の状態の指標を参照。R1 では文章で受ける。',
    requirementIds: ['REQ-TNFD-013'],
  },
  {
    id: 'species_extinction_risk',
    tnfdCode: 'C5.2',
    category: 'state_of_nature',
    label: '種の絶滅リスク',
    unit: null,
    unitSelectable: false,
    inputKind: 'manual_text',
    enabledInR1: false,
    guide: 'R1 では文章で受ける。',
    requirementIds: ['REQ-TNFD-013'],
  },
  // ---- リスク・機会（ISSB 公開草案の受け皿。確定） ----
  {
    id: 'vulnerable_assets_amount',
    tnfdCode: null,
    category: 'risk_opportunity',
    label: '自然関連リスクに脆弱な資産・事業活動の金額',
    unit: '円',
    unitSelectable: true,
    inputKind: 'manual_number',
    enabledInR1: true,
    guide: 'OGT は財務データを持たないため手入力。どの資産を対象にしたかを補足文に書く。ISSB 公開草案への対応は任意。',
    requirementIds: ['REQ-ISSB-003', 'REQ-TNFD-012'],
  },
  {
    id: 'vulnerable_assets_share',
    tnfdCode: null,
    category: 'risk_opportunity',
    label: '自然関連リスクに脆弱な資産・事業活動の割合',
    unit: '%',
    unitSelectable: false,
    inputKind: 'manual_number',
    enabledInR1: true,
    guide: '分母（総資産か総生産額かなど）を補足文に書く。ISSB 公開草案への対応は任意。',
    requirementIds: ['REQ-ISSB-003', 'REQ-TNFD-012'],
  },
];

/** 指標 ID から定義を引く。無ければ undefined。 */
export const findTnfdMetric = (id: TnfdMetricId): TnfdMetricDefinition | undefined =>
  TNFD_METRICS.find(metric => metric.id === id);

/** 分類に属する指標（マスターの順）。 */
export const tnfdMetricsOfCategory = (category: TnfdMetricCategory): TnfdMetricDefinition[] =>
  TNFD_METRICS.filter(metric => metric.category === category);

/** R1 で入力欄を出す指標。 */
export const tnfdMetricsEnabledInR1 = (): TnfdMetricDefinition[] => TNFD_METRICS.filter(metric => metric.enabledInR1);

/** GHG（OGT の採用値）の指標か。 */
export const isTnfdGhgMetricId = (id: TnfdMetricId): boolean =>
  (Object.values(TNFD_GHG_METRIC_IDS) as string[]).includes(id);
