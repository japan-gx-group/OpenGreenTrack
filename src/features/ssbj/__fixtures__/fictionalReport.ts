// SSBJ 開示レポートの架空の検証データ（1 社・1 年度）。
//
// ⚠️ 架空データであり、会社名・数値・文章・項目 ID・要求 ID は実在の企業や開示、基準の項番号と無関係。
// 各機能の単体テストが共通の入力例として使う。境界ケース（回答済みの 0 / 未入力 / 未確認 / 非該当 /
// Scope 2 基準不明 / Scope 3 未算定 / 開示文と内部メモの併存）を意図的に含めているので、
// 値を変えるときはそれらのケースを消さないこと（__tests__/fictionalReport.test.ts が確認する）。
// 対象範囲・基本情報の項目は T01 合意待ちの仮置き（docs/ssbj-spec.md §12）。

import type {
  OgtAdoptedValue,
  OgtCandidateValue,
  OgtSupplierReference,
  OgtValueSource,
  SsbjDisclosableText,
  SsbjItemId,
  SsbjReportBasicInfo,
  SsbjReportSnapshotV1,
  SsbjReportVersion,
  SsbjRequirementId,
  SsbjRiskOpportunity,
} from '../types';

export const FICTIONAL_ORGANIZATION_ID = '5b1f0000-0000-4000-8000-000000000001';
export const FICTIONAL_FISCAL_YEAR_ID = '5b1f0000-0000-4000-8000-000000000002';
export const FICTIONAL_REPORT_ID = '5b1f0000-0000-4000-8000-000000000003';
export const FICTIONAL_VERSION_ID = '5b1f0000-0000-4000-8000-000000000004';
export const FICTIONAL_USER_ID = '5b1f0000-0000-4000-8000-000000000005';
export const FICTIONAL_BATCH_ID = '5b1f0000-0000-4000-8000-000000000006';
export const FICTIONAL_SUPPLIER_ID = '5b1f0000-0000-4000-8000-000000000007';

export const FICTIONAL_FISCAL_YEAR = {
  id: FICTIONAL_FISCAL_YEAR_ID,
  label: '2024年度',
  startDate: '2024-04-01',
  endDate: '2025-03-31',
} as const;

export const fictionalReportBasicInfo: SsbjReportBasicInfo = {
  id: FICTIONAL_REPORT_ID,
  organizationId: FICTIONAL_ORGANIZATION_ID,
  fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
  title: '架空サンプル株式会社 サステナビリティ関連財務開示（試行）2024年度',
  purpose: '社内での記載内容の確認',
  reportingScope: '架空サンプル株式会社（単体）',
  standardVersion: null,
  createdAt: '2025-06-02T01:00:00.000Z',
  updatedAt: '2025-06-02T01:00:00.000Z',
};

/** 項目ごとの文章。項目 ID は架空（基準の項番号ではない）。 */
export const fictionalDisclosableTexts: Record<SsbjItemId, SsbjDisclosableText> = {
  // 開示文と内部メモが両方ある
  'governance.oversight_body': {
    disclosure: {
      state: 'answered',
      value: '取締役会は年2回、気候関連のリスク及び機会の報告を受け、対応方針を監督している。',
    },
    internalNote: '開催回数は総務部の議事録で確認済み。保管先は社内共有フォルダ（架空）。',
  },
  // 未確認（下書きはあるが確定していない。値は持たない）
  'strategy.climate_resilience': {
    disclosure: { state: 'unconfirmed' },
    internalNote: 'シナリオ分析の前提を経営企画部に確認中。',
  },
  // 非該当
  'risk_management.process_integration': {
    disclosure: { state: 'not_applicable' },
    internalNote: null,
  },
  // 未入力
  'metrics_targets.climate_targets': {
    disclosure: { state: 'unanswered' },
    internalNote: null,
  },
};

/** 文章と要求項目の対応（1 つの文章が複数の要求を説明できる）。要求 ID は架空。 */
export const fictionalRequirementLinks: { itemId: SsbjItemId; requirementIds: SsbjRequirementId[] }[] = [
  { itemId: 'governance.oversight_body', requirementIds: ['REQ-GEN-001', 'REQ-CLM-001'] },
  { itemId: 'strategy.climate_resilience', requirementIds: ['REQ-CLM-002'] },
  { itemId: 'risk_management.process_integration', requirementIds: ['REQ-GEN-002'] },
  { itemId: 'metrics_targets.climate_targets', requirementIds: ['REQ-CLM-003'] },
];

/**
 * リスク・機会（T07）。文章の項目（fictionalDisclosableTexts）への関連付けと、章だけへの関連付け、
 * 関連なしの例を含む。説明・時間軸は回答済み / 未確認 / 未入力を含む。
 */
export const fictionalRisksOpportunities: SsbjRiskOpportunity[] = [
  {
    id: '5b1f0000-0000-4000-8000-000000000101',
    kind: 'risk',
    title: '炭素価格の導入による調達コストの上昇',
    description: {
      disclosure: {
        state: 'answered',
        value: '炭素価格が導入された場合、主要原材料の調達コストが上昇する可能性がある。',
      },
      internalNote: '影響額の試算は経営企画部で実施中（架空）。',
    },
    timeHorizon: { state: 'answered', value: 'medium_term' },
    linkTargets: ['strategy', 'strategy.climate_resilience'],
  },
  {
    id: '5b1f0000-0000-4000-8000-000000000102',
    kind: 'opportunity',
    title: '省エネルギー型製品の需要拡大',
    description: {
      disclosure: { state: 'unconfirmed' },
      internalNote: '営業部に市場見通しを確認中。',
    },
    timeHorizon: { state: 'answered', value: 'long_term' },
    linkTargets: ['metrics_targets.climate_targets'],
  },
  {
    id: '5b1f0000-0000-4000-8000-000000000103',
    kind: 'risk',
    title: '豪雨による拠点の操業停止',
    description: { disclosure: { state: 'unanswered' }, internalNote: null },
    timeHorizon: { state: 'unanswered' },
    linkTargets: [],
  },
];

const FICTIONAL_PERIOD = {
  startDate: FICTIONAL_FISCAL_YEAR.startDate,
  endDate: FICTIONAL_FISCAL_YEAR.endDate,
};

const aggregateSource: OgtValueSource = {
  kind: 'ogt',
  aggregate: 'dashboard_aggregates',
  aggregateUpdatedAt: '2025-05-30T09:00:00.000Z',
  latestBatch: { id: FICTIONAL_BATCH_ID, status: 'completed', completedAt: '2025-05-30T09:00:00.000Z' },
};

const scope3CategorySource: OgtValueSource = {
  ...aggregateSource,
  aggregate: 'dashboard_scope3_category_emissions',
};

/** OGT の候補値（T08a の出力例）。 */
export const fictionalOgtCandidates: OgtCandidateValue[] = [
  // Scope 1: すべて算定済み
  {
    scope: 1,
    scope3CategoryId: null,
    method: { kind: 'activity_based' },
    value: { state: 'answered', value: '812.345' },
    unit: 't-CO2e',
    fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
    period: FICTIONAL_PERIOD,
    boundary: { kind: 'organization' },
    dataQuality: 'all_calculated',
    coverage: { calculatedCount: 24, uncalculatedCount: 0 },
    source: aggregateSource,
  },
  // Scope 2: 基準不明（OGT にマーケット／ロケーション基準の区別が無い）・一部未算定・基礎/調整後が混在
  {
    scope: 2,
    scope3CategoryId: null,
    method: {
      kind: 'activity_based',
      scope2Basis: 'unknown',
      factorTypeBreakdown: { basic: '120.500', adjusted: '1045.250', unclassified: '0' },
    },
    value: { state: 'answered', value: '1165.750' },
    unit: 't-CO2e',
    fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
    period: FICTIONAL_PERIOD,
    boundary: { kind: 'organization' },
    dataQuality: 'partially_calculated',
    coverage: { calculatedCount: 22, uncalculatedCount: 2 },
    source: aggregateSource,
  },
  // Scope 3 カテゴリ 1: 直接入力で、確認した結果が 0（回答済みの 0）
  {
    scope: 3,
    scope3CategoryId: 1,
    method: { kind: 'direct' },
    value: { state: 'answered', value: '0' },
    unit: 't-CO2e',
    fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
    period: FICTIONAL_PERIOD,
    boundary: { kind: 'organization' },
    dataQuality: 'all_calculated',
    coverage: null,
    source: { ...scope3CategorySource, aggregate: 'scope3_category_emissions' },
  },
  // Scope 3 カテゴリ 4: 積上げだが算定済みレコードが無い（未算定。0 を入れない）
  {
    scope: 3,
    scope3CategoryId: 4,
    method: { kind: 'calculated' },
    value: { state: 'unanswered' },
    unit: 't-CO2e',
    fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
    period: FICTIONAL_PERIOD,
    boundary: { kind: 'organization' },
    dataQuality: 'not_calculated',
    coverage: { calculatedCount: 0, uncalculatedCount: 3 },
    source: scope3CategorySource,
  },
  // Scope 3 カテゴリ 6: 積上げで算定済み
  {
    scope: 3,
    scope3CategoryId: 6,
    method: { kind: 'calculated' },
    value: { state: 'answered', value: '35.120' },
    unit: 't-CO2e',
    fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
    period: FICTIONAL_PERIOD,
    boundary: { kind: 'organization' },
    dataQuality: 'all_calculated',
    coverage: { calculatedCount: 12, uncalculatedCount: 0 },
    source: scope3CategorySource,
  },
];

/** 採用値（T08b の出力例）。候補値のうち Scope 1・2 を利用者が明示的に採用した状態。 */
export const fictionalOgtAdoptedValues: OgtAdoptedValue[] = fictionalOgtCandidates
  .filter(candidate => candidate.scope !== 3)
  .map(candidate => ({
    ...candidate,
    adoptedAt: '2025-06-03T02:00:00.000Z',
    adoptedBy: FICTIONAL_USER_ID,
  }));

/** サプライヤー別実排出量（参考値）。Scope 3 の合計には足さない。 */
export const fictionalSupplierReferences: OgtSupplierReference[] = [
  {
    kind: 'supplier_reference',
    fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
    scope3CategoryId: 1,
    supplierId: FICTIONAL_SUPPLIER_ID,
    supplierName: '架空部品工業株式会社',
    emissions: '52.000',
    unit: 't-CO2e',
  },
];

/** 保存版の中身の例。セクションは実装済みの機能の分だけ入る（未実装の機能のキーは無い）。 */
export const fictionalSnapshot: SsbjReportSnapshotV1 = {
  schemaVersion: 1,
  report: {
    ...fictionalReportBasicInfo,
    fiscalYearLabel: FICTIONAL_FISCAL_YEAR.label,
    periodStart: FICTIONAL_FISCAL_YEAR.startDate,
    periodEnd: FICTIONAL_FISCAL_YEAR.endDate,
  },
  sections: {
    risks_opportunities: fictionalRisksOpportunities,
  },
};

export const fictionalVersion: SsbjReportVersion = {
  id: FICTIONAL_VERSION_ID,
  reportId: FICTIONAL_REPORT_ID,
  versionNumber: 1,
  snapshot: fictionalSnapshot,
  basedOnDraftRevision: 3,
  sourceVersionId: null,
  note: '初回の社内確認用',
  createdBy: FICTIONAL_USER_ID,
  createdAt: '2025-06-03T03:00:00.000Z',
};
