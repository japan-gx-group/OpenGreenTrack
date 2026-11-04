// TNFD 開示レポートの架空の検証データ（1 社・1 年度）。
//
// ⚠️ 架空データであり、会社名・数値・文章・項目 ID・要求 ID は実在の企業や開示、提言のラベルと無関係。
// SSBJ の架空サンプル株式会社と同じ組織・同じ年度にしてある（同じ組織の SSBJ レポートと TNFD レポートを
// 並べて、GHG の値が一致することをテストで確かめるため。docs/tnfd-spec.md §14）。
// 境界ケース（回答済みの 0 / 未入力 / 未確認 / 非該当 / 緯度経度なしの拠点 / 開示文と内部メモの併存 /
// 単位の変更 / 文章のみの指標）を意図的に含めているので、値を変えるときはそれらのケースを消さないこと
// （__tests__/fictionalReport.test.ts が確認する）。

import {
  FICTIONAL_FISCAL_YEAR,
  FICTIONAL_FISCAL_YEAR_ID,
  FICTIONAL_ORGANIZATION_ID,
  FICTIONAL_USER_ID,
  fictionalOgtAdoptedValues,
} from '@/features/ssbj/__fixtures__/fictionalReport';
import type {
  TnfdDisclosableText,
  TnfdItemId,
  TnfdLocationAssessment,
  TnfdMetricValue,
  TnfdNarrative,
  TnfdReportBasicInfo,
  TnfdReportRecord,
  TnfdReportSnapshotV1,
  TnfdReportVersion,
  TnfdRequirementId,
} from '../types';

export { FICTIONAL_FISCAL_YEAR, FICTIONAL_FISCAL_YEAR_ID, FICTIONAL_ORGANIZATION_ID, FICTIONAL_USER_ID };

export const FICTIONAL_TNFD_REPORT_ID = '7c2e0000-0000-4000-8000-000000000001';
export const FICTIONAL_TNFD_VERSION_ID = '7c2e0000-0000-4000-8000-000000000002';
export const FICTIONAL_LOCATION_ID_NAGOYA = '7c2e0000-0000-4000-8000-000000000011';
export const FICTIONAL_LOCATION_ID_FUKUOKA = '7c2e0000-0000-4000-8000-000000000012';
export const FICTIONAL_LOCATION_ID_TOKYO = '7c2e0000-0000-4000-8000-000000000013';

export const fictionalTnfdReportBasicInfo: TnfdReportBasicInfo = {
  id: FICTIONAL_TNFD_REPORT_ID,
  organizationId: FICTIONAL_ORGANIZATION_ID,
  fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
  title: '架空サンプル株式会社 自然関連財務情報開示（試行）2024年度',
  purpose: '社内での記載内容の確認',
  reportingScope: '架空サンプル株式会社（単体）。上流は主要原材料の調達先 10 社まで',
  standardVersion: 'Recommendations of the TNFD, October 2026',
  createdAt: '2025-06-02T01:00:00.000Z',
  updatedAt: '2025-06-02T01:00:00.000Z',
};

export const fictionalTnfdReportRecord: TnfdReportRecord = {
  ...fictionalTnfdReportBasicInfo,
  fiscalYearLabel: FICTIONAL_FISCAL_YEAR.label,
  periodStart: FICTIONAL_FISCAL_YEAR.startDate,
  periodEnd: FICTIONAL_FISCAL_YEAR.endDate,
};

/** 四本柱の各章に 1 項目ずつ（回答済み＋内部メモ / 未確認 / 非該当 / ISSB 受け皿の回答済み）。 */
export const fictionalTnfdDisclosableTexts: Record<TnfdItemId, TnfdDisclosableText> = {
  'governance.board_oversight': {
    disclosure: {
      state: 'answered',
      value: '取締役会は、サステナビリティ委員会からの半期ごとの報告を通じて、自然関連の依存・インパクト・リスク・機会を監督している。',
    },
    internalNote: '委員会の設置規程は総務部が保管。2024 年度は 9 月と 3 月に報告。',
  },
  'strategy.priority_locations': {
    disclosure: { state: 'unconfirmed' },
    internalNote: '名古屋工場の判定根拠（環境省の自然環境調査との重なり）を確認中。',
  },
  'risk_impact_management.value_chain_process': {
    disclosure: { state: 'not_applicable' },
    internalNote: '下流は対象外と判断（製品が最終消費者に直接渡らないため）。',
  },
  'metrics_targets.targets': {
    disclosure: {
      state: 'answered',
      value: '2030 年度までに取水量を 2024 年度比 10% 削減する目標を設定している。2024 年度は基準年のため削減率は 0%。',
    },
    internalNote: null,
  },
  'strategy.scenario_analysis': {
    disclosure: { state: 'answered', value: 'していない。' },
    internalNote: null,
  },
};

export const fictionalTnfdNarratives: TnfdNarrative[] = (
  Object.entries(fictionalTnfdDisclosableTexts) as [TnfdItemId, TnfdDisclosableText][]
).map(([itemId, text]) => ({ itemId, text }));

/** 文章と要求の対応（TNFD の提言と ISSB 草案の要求に 1 つの文章で答える例を含む）。 */
export const fictionalTnfdRequirementLinks: { itemId: TnfdItemId; requirementIds: TnfdRequirementId[] }[] = [
  { itemId: 'governance.board_oversight', requirementIds: ['REQ-TNFD-001'] },
  { itemId: 'governance.human_rights_engagement', requirementIds: ['REQ-TNFD-003', 'REQ-TNFD-020'] },
  { itemId: 'strategy.scenario_analysis', requirementIds: ['REQ-ISSB-002'] },
];

const manualSource = { kind: 'manual', enteredByUserId: FICTIONAL_USER_ID, enteredAt: '2025-06-02T02:00:00.000Z' } as const;

/** 手入力指標（回答済みの 0 / 未入力 / 非該当 / 単位を変えた例 / 文章のみの指標）。 */
export const fictionalTnfdMetricValues: TnfdMetricValue[] = [
  {
    metricId: 'water_withdrawal',
    value: { state: 'answered', value: '12500.5' },
    unit: 'm³',
    boundary: { kind: 'organization' },
    method: {
      disclosure: { state: 'answered', value: '各拠点の水道・地下水の取水メーターの実績を合計した。' },
      internalNote: '福岡工場の地下水は 3 月分が推計。',
    },
    source: manualSource,
  },
  {
    metricId: 'plastic',
    value: { state: 'answered', value: '0' },
    unit: 't',
    boundary: { kind: 'organization' },
    method: {
      disclosure: { state: 'answered', value: '製品・包装にプラスチックを使用していない。' },
      internalNote: null,
    },
    source: manualSource,
  },
  {
    metricId: 'waste',
    value: { state: 'unanswered' },
    unit: 't',
    boundary: { kind: 'organization' },
    method: { disclosure: { state: 'unanswered' }, internalNote: '産廃マニフェストの集計待ち。' },
    source: manualSource,
  },
  {
    metricId: 'high_risk_commodities',
    value: { state: 'not_applicable' },
    unit: 't',
    boundary: { kind: 'organization' },
    method: {
      disclosure: { state: 'answered', value: '高リスク天然コモディティに該当する原材料を調達していない。' },
      internalNote: null,
    },
    source: manualSource,
  },
  {
    metricId: 'spatial_footprint',
    value: { state: 'answered', value: '0.42' },
    // 既定の km² から変更した例（unitSelectable: true の指標）。
    unit: 'ha',
    boundary: { kind: 'organization' },
    method: {
      disclosure: { state: 'answered', value: '登記簿の敷地面積を合計した（ha 表記）。' },
      internalNote: null,
    },
    source: manualSource,
  },
  {
    metricId: 'invasive_species',
    value: { state: 'answered', value: '工場敷地内の外来植物の繁茂を年 1 回点検し、除去している。' },
    unit: null,
    boundary: { kind: 'organization' },
    method: { disclosure: { state: 'unanswered' }, internalNote: null },
    source: manualSource,
  },
  {
    metricId: 'vulnerable_assets_share',
    value: { state: 'answered', value: '18.5' },
    unit: '%',
    boundary: { kind: 'organization' },
    method: {
      disclosure: { state: 'answered', value: '水ストレス地域に立地する拠点の有形固定資産の帳簿価額の割合。' },
      internalNote: null,
    },
    source: manualSource,
  },
];

/** 拠点 3 件（該当あり・根拠あり / 該当なし / 未判定、緯度経度あり・なし）。 */
export const fictionalTnfdLocationAssessments: TnfdLocationAssessment[] = [
  {
    locationId: FICTIONAL_LOCATION_ID_NAGOYA,
    locationName: '名古屋工場',
    address: '愛知県名古屋市（架空）',
    latitude: '35.170915',
    longitude: '136.881537',
    sensitivity: 'sensitive',
    basis: {
      disclosure: { state: 'answered', value: '環境省の自然環境調査で重要とされる湿地の集水域内に立地する。' },
      internalNote: '判定は環境部が 2025-05 に実施。地図の出典は内部資料フォルダ参照。',
    },
  },
  {
    locationId: FICTIONAL_LOCATION_ID_FUKUOKA,
    locationName: '福岡工場',
    address: '福岡県福岡市（架空）',
    latitude: '33.590355',
    longitude: '130.401716',
    sensitivity: 'not_sensitive',
    basis: {
      disclosure: { state: 'answered', value: '保護区・重要地域との重なりは無い。' },
      internalNote: null,
    },
  },
  {
    locationId: FICTIONAL_LOCATION_ID_TOKYO,
    locationName: '東京本社',
    address: null,
    latitude: null,
    longitude: null,
    sensitivity: 'unassessed',
    basis: { disclosure: { state: 'unanswered' }, internalNote: null },
  },
];

/** 保存版の例。GHG は SSBJ の架空の採用値をそのまま使う（同じ組織・同じ年度で値が一致することの確認用）。 */
export const fictionalTnfdSnapshot: TnfdReportSnapshotV1 = {
  schemaVersion: 1,
  report: fictionalTnfdReportRecord,
  sections: {
    narratives: fictionalTnfdNarratives,
    metrics: { values: fictionalTnfdMetricValues, ghg: fictionalOgtAdoptedValues },
    location_assessments: fictionalTnfdLocationAssessments,
  },
};

export const fictionalTnfdVersion: TnfdReportVersion = {
  id: FICTIONAL_TNFD_VERSION_ID,
  reportId: FICTIONAL_TNFD_REPORT_ID,
  versionNumber: 1,
  snapshot: fictionalTnfdSnapshot,
  basedOnDraftRevision: 7,
  sourceVersionId: null,
  note: '社内確認用の初版',
  createdBy: FICTIONAL_USER_ID,
  createdAt: '2025-06-03T03:00:00.000Z',
};
