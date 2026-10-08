// SSBJ 開示レポート（試行版 R1）の共通データ契約。
//
// レポート作成・文章・リスク・OGT 採用値・判断・根拠・保存版・プレビュー・CSV の各機能が、
// 同じ識別子・値の状態・保存形式でつながるための型をここに集める。仕様の正本は docs/ssbj-spec.md。
// 各機能固有の型はその機能の実装と一緒に追記してよいが、ここにある型の意味（特に値の状態と
// 開示文 / 内部記録の区分）は変えないこと。後続の機能がすべてこの前提でデータを読み書きする。
//
// R1 は社内確認用の試行版であり、SSBJ 基準への準拠や対外提出を保証するものではない。

// ---------------------------------------------------------------------------
// 識別子
// ---------------------------------------------------------------------------

/** 章（四本柱）の ID。画面・DB・保存版・CSV で同じ値を使う。 */
export const SSBJ_SECTION_IDS = [
  'governance',
  'strategy',
  'risk_management',
  'metrics_targets',
] as const;

export type SsbjSectionId = (typeof SSBJ_SECTION_IDS)[number];

/** 章の表示ラベル（画面・プレビュー・CSV で共通）。 */
export const SSBJ_SECTION_LABELS: Record<SsbjSectionId, string> = {
  governance: 'ガバナンス',
  strategy: '戦略',
  risk_management: 'リスク管理',
  metrics_targets: '指標及び目標',
};

/**
 * 項目 ID。`<章ID>.<slug>`（slug は英小文字・数字・アンダースコア）。
 * アプリ内の安定キーであり、基準の項番号ではない（項番号との対応は要求項目マスターが持つ）。
 * 形式の検証は utils/ids.ts の isSsbjItemId で行う。
 */
export type SsbjItemId = `${SsbjSectionId}.${string}`;

/** 要求 ID の基準コード。APP = 適用基準 / GEN = 一般開示基準 / CLM = 気候関連開示基準。 */
export const SSBJ_STANDARD_CODES = ['APP', 'GEN', 'CLM'] as const;

export type SsbjStandardCode = (typeof SSBJ_STANDARD_CODES)[number];

export const SSBJ_STANDARD_LABELS: Record<SsbjStandardCode, string> = {
  APP: '適用基準',
  GEN: '一般開示基準',
  CLM: '気候関連開示基準',
};

/**
 * 要求 ID。`REQ-<基準コード>-<3桁連番>`（例 `REQ-CLM-001`）。
 * 基準の項番号は ID に埋め込まない。項番号が改訂されても ID を変えずに済むようにするため
 * （項番号との対応は要求項目マスターの別の列で持つ）。
 * 形式の検証は utils/ids.ts の isSsbjRequirementId で行う。
 */
export type SsbjRequirementId = `REQ-${SsbjStandardCode}-${string}`;

/** レポート ID（ssbj_reports.id。DB が生成する UUID）。 */
export type SsbjReportId = string;

/** 保存版 ID（ssbj_report_versions.id。DB が生成する UUID）。 */
export type SsbjVersionId = string;

// ---------------------------------------------------------------------------
// 要求項目マスター（T32a。データは utils/requirementMaster.ts）
// ---------------------------------------------------------------------------

/**
 * 項番号を示すときの基準。要求 ID の基準コードに、実務対応基準第1号（PRA1）を加えたもの。
 * 実務対応基準は要求 ID を作らず、関係する気候基準の要求の参照先として持つ（docs/ssbj-r1-scope.md §4）。
 */
export const SSBJ_REFERENCE_STANDARDS = ['APP', 'GEN', 'CLM', 'PRA1'] as const;

export type SsbjReferenceStandard = (typeof SSBJ_REFERENCE_STANDARDS)[number];

/** 基準の項番号の参照（例 `{ standard: 'CLM', paragraphs: '19(2)' }`）。本文は持たない（§1）。 */
export type SsbjParagraphReference = {
  standard: SsbjReferenceStandard;
  paragraphs: string;
};

/** 初回対象としての重み。core = 親会社への提出の中心（◎）、basic = 答えやすいため含める（○）。 */
export type SsbjRequirementPriority = 'core' | 'basic';

/**
 * 要求にどこで答えるか。narrative は四本柱の文章（T05）の項目、それ以外は既存の機能か固定の注記。
 * notice は利用者の入力ではなく、プレビュー・出力の注記で扱うもの（OGT が対応していない要求など）。
 */
export type SsbjRequirementInputTarget =
  | { kind: 'narrative'; itemId: SsbjItemId }
  | { kind: 'basic_info' }
  | { kind: 'risks_opportunities' }
  | { kind: 'time_horizons' }
  | { kind: 'ghg' }
  | { kind: 'notice' };

/** 要求項目マスターの 1 行（基準が求めること 1 つ）。 */
export type SsbjRequirement = {
  id: SsbjRequirementId;
  /** 属する章。報告企業・比較情報など章にまたがる全般の要求は null。 */
  sectionId: SsbjSectionId | null;
  /** 要求の要約（基準の本文ではなく、この試行版の言葉で書く）。 */
  summary: string;
  references: SsbjParagraphReference[];
  priority: SsbjRequirementPriority;
  inputTarget: SsbjRequirementInputTarget;
  /** 記載ガイド（何を書くか・OGT の制約・「していない」場合の書き方）。 */
  guide: string;
};

/**
 * 四本柱の文章（T05）の項目。1 つの項目で複数の要求に答えられる（一般開示基準と気候関連開示基準の
 * 共通記載を二重に入力しないため）。company_supplement は要求に対応しない企業固有の補足。
 */
export type SsbjNarrativeItem = {
  id: SsbjItemId;
  kind: 'requirement' | 'company_supplement';
  label: string;
  requirementIds: SsbjRequirementId[];
  /** 記載例（架空の会社の文例）。 */
  example: string;
  /**
   * 穴埋めテンプレート（試行版の初期文例）。【 】の部分を自社の言葉に置き換えて使う。
   * チームが作った文例で、外部の監修は受けていない（docs/ssbj-r1-scope.md §8）。
   */
  template: string;
};

// ---------------------------------------------------------------------------
// 値の状態
// ---------------------------------------------------------------------------

/**
 * 入力欄の状態。数値 0 は `answered` かつ値 "0" であり、`unanswered`（未入力）とは別物。
 * 未入力を 0・空文字・「なし」に置き換えると「排出ゼロ」「該当なし」と誤読されるため、
 * 状態を値と切り離して必ず持つ。DB では enum ssbj_field_state ＋ 値列で表す（docs/ssbj-spec.md §4）。
 */
export const SSBJ_FIELD_STATES = ['unanswered', 'unconfirmed', 'not_applicable', 'answered'] as const;

export type SsbjFieldState = (typeof SSBJ_FIELD_STATES)[number];

/** 状態つきの値。値を持てるのは `answered` のときだけ。 */
export type SsbjFieldValue<T> =
  | { state: 'unanswered' }
  | { state: 'unconfirmed' }
  | { state: 'not_applicable' }
  | { state: 'answered'; value: T };

/**
 * 十進表記の数値文字列（例 "1234.567" / "0"）。指数表記・カンマ・全角は使わない。
 * DB の numeric を number に変換すると桁落ち・丸めが起きるため、受け渡しは文字列で行う。
 * 形式の検証は utils/decimal.ts の isDecimalString で行う。
 */
export type SsbjDecimalString = string;

/**
 * 開示する文章と内部記録を分けて持つ文章。
 * 1 つの列＋「公開/内部」フラグにすると、出力時のフィルタ漏れで内部記録が開示欄に混ざるため、
 * 最初から別のプロパティ（DB では別の列）にする。プレビュー・CSV の開示欄には disclosure だけを出す。
 */
export type SsbjDisclosableText = {
  /** 開示に載せる文章。 */
  disclosure: SsbjFieldValue<string>;
  /** 内部の検討メモ・確認先など。開示しない。 */
  internalNote: string | null;
};

/**
 * 四本柱・企業固有の補足の文章 1 項目（T05。ssbj_narratives の 1 行）。項目 ID は要求項目マスター
 * （utils/requirementMaster.ts）の文章の項目。1 つの項目で複数の要求に答える。
 */
export type SsbjNarrative = {
  itemId: SsbjItemId;
  text: SsbjDisclosableText;
};

// ---------------------------------------------------------------------------
// 該当性・重要性・記載しない理由（T09）
// ---------------------------------------------------------------------------

/** 該当性。この会社に当てはまる要求か。既定は未確認（ソフトは判断しない）。 */
export const SSBJ_APPLICABILITIES = ['unconfirmed', 'applicable', 'not_applicable'] as const;
export type SsbjApplicability = (typeof SSBJ_APPLICABILITIES)[number];

/** 重要性。情報に重要性があるか（適用基準 第22項）。既定は未確認。 */
export const SSBJ_MATERIALITIES = ['unconfirmed', 'material', 'not_material'] as const;
export type SsbjMateriality = (typeof SSBJ_MATERIALITIES)[number];

/**
 * 記載しない理由。none = 記載する / not_material = 重要性がない（適用基準 第22項）/ transition_relief = 経過措置
 * （適用基準 第94項、気候関連開示基準 第103項）/ commercial_sensitivity = 機会の情報の商業上の機密（適用基準 第13項）/ other。
 */
export const SSBJ_OMISSION_REASONS = ['none', 'not_material', 'transition_relief', 'commercial_sensitivity', 'other'] as const;
export type SsbjOmissionReason = (typeof SSBJ_OMISSION_REASONS)[number];

/**
 * 要求 1 件についての判断（ssbj_judgements の 1 行）。explanation の disclosure は開示する説明（例: 経過措置を適用している旨）、
 * internalNote は内部の検討理由（開示しない）。リスクの識別（T07）とは別の概念として持つ。
 */
export type SsbjJudgement = {
  requirementId: SsbjRequirementId;
  applicability: SsbjApplicability;
  materiality: SsbjMateriality;
  omissionReason: SsbjOmissionReason;
  explanation: SsbjDisclosableText;
};

// ---------------------------------------------------------------------------
// レポートの基本情報（T04 が作成・編集する）
// ---------------------------------------------------------------------------

/** 親会社との関係（docs/ssbj-r1-scope.md §2）。 */
export const SSBJ_PARENT_RELATIONSHIPS = [
  'consolidated_subsidiary',
  'non_consolidated_subsidiary',
  'equity_method_affiliate',
  'other',
] as const;

export type SsbjParentRelationship = (typeof SSBJ_PARENT_RELATIONSHIPS)[number];

export const SSBJ_PARENT_RELATIONSHIP_LABELS: Record<SsbjParentRelationship, string> = {
  consolidated_subsidiary: '連結子会社',
  non_consolidated_subsidiary: '非連結子会社',
  equity_method_affiliate: '持分法適用関連会社',
  other: 'その他',
};

/** 温室効果ガス排出の測定アプローチ（気候関連開示基準 第60項）。親会社の選択に合わせる。 */
export const SSBJ_MEASUREMENT_APPROACHES = ['equity_share', 'operational_control', 'financial_control'] as const;

export type SsbjMeasurementApproach = (typeof SSBJ_MEASUREMENT_APPROACHES)[number];

export const SSBJ_MEASUREMENT_APPROACH_LABELS: Record<SsbjMeasurementApproach, string> = {
  equity_share: '持分割合アプローチ',
  operational_control: '経営支配力アプローチ',
  financial_control: '財務支配力アプローチ',
};

/**
 * レポートの基本情報。組織と算定年度に必ず結び付く。項目と必須性は T01 の合意（docs/ssbj-r1-scope.md）。
 * 必須はレポート名だけで、ほかは任意（未入力は null）。
 */
export type SsbjReportBasicInfo = {
  id: SsbjReportId;
  organizationId: string;
  fiscalYearId: string;
  /** レポート名（必須）。 */
  title: string;
  /** 作成目的（任意。仮置き）。 */
  purpose: string | null;
  /** 報告範囲・対象範囲（任意。仮置き）。例: 「単体」「連結子会社を含む」。 */
  reportingScope: string | null;
  /** 参照する基準の版（任意。仮置き）。 */
  standardVersion: string | null;
  /** 親会社名（任意）。レポートの提出先。 */
  parentCompanyName: string | null;
  /** 親会社との関係（任意）。 */
  parentRelationship: SsbjParentRelationship | null;
  /** 親会社の持分比率（%、任意）。十進表記の文字列（例 "80.50"）。 */
  ownershipPercentage: SsbjDecimalString | null;
  /** 測定アプローチ（任意）。 */
  measurementApproach: SsbjMeasurementApproach | null;
  /** 業種（任意）。SICS の産業コード（例 "RT-IG"。utils/sicsIndustries.ts）。 */
  industryCode: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 基本情報に算定年度の表示情報を添えたもの。画面の一覧・詳細と、保存版の report（SsbjReportSnapshotV1）で共通。
 * 年度のラベルと期間を一緒に持つのは、年度が後から改名されても保存版では作成時点の表記を再現するため。
 */
export type SsbjReportRecord = SsbjReportBasicInfo & {
  fiscalYearLabel: string;
  periodStart: string;
  periodEnd: string;
};

/**
 * 画面が編集中に持つレポート。draftRevision は読込時点の作業状態の版数で、保存版を作るときに渡して
 * 競合（別の画面・別の人の変更）を検知する（docs/ssbj-spec.md §8）。保存版の report には含めない。
 */
export type SsbjReportWorkingRecord = SsbjReportRecord & {
  draftRevision: number;
  review: SsbjReportReview;
};

// ---------------------------------------------------------------------------
// 状態管理と承認ロック（docs/ssbj-spec.md §13）
// ---------------------------------------------------------------------------

/** レポートの状態。承認済みの間は作業中データを変更できない（DB が止める）。 */
export const SSBJ_REPORT_STATUSES = ['draft', 'in_review', 'approved'] as const;

export type SsbjReportStatus = (typeof SSBJ_REPORT_STATUSES)[number];

export const SSBJ_REPORT_STATUS_LABELS: Record<SsbjReportStatus, string> = {
  draft: '作成中',
  in_review: 'レビュー中',
  approved: '承認済み',
};

/** 状態を変える操作。submit = レビュー依頼、withdraw = 依頼の取り下げ、approve = 承認、reopen = 差戻し。 */
export const SSBJ_REPORT_STATUS_ACTIONS = ['submit', 'withdraw', 'approve', 'reopen'] as const;

export type SsbjReportStatusAction = (typeof SSBJ_REPORT_STATUS_ACTIONS)[number];

/** レポートの状態と承認の記録（保存版の report には含めない。作業中のレポートだけが持つ）。 */
export type SsbjReportReview = {
  status: SsbjReportStatus;
  /** レビューを依頼された承認者（profiles.id）。承認と差戻しができる。 */
  approverUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  /** 承認したときに作った保存版。 */
  approvedVersionId: SsbjVersionId | null;
  statusChangedAt: string | null;
};

// ---------------------------------------------------------------------------
// OGT の算定値（T08a が候補値を出し、T08b がレポートへ採用・固定する）
// ---------------------------------------------------------------------------

/** OGT の排出量の単位。OGT の表示単位（t-CO2e 固定）に合わせる。 */
export const OGT_EMISSION_UNIT = 't-CO2e';

/**
 * 集計範囲。R1 は OGT の年度集計（組織全体）だけを扱う。
 * 拠点別の値を扱う場合に備え、組織全体と拠点を区別できる形にしておく。
 */
export type OgtBoundary =
  | { kind: 'organization' }
  | { kind: 'location'; locationId: string; locationName: string };

/**
 * Scope 2 の算定基準。OGT はマーケット基準／ロケーション基準の区別を実装していないため、
 * OGT 由来の値は常に `unknown`。location_based / market_based は、利用者が別途確認した場合などに
 * 備えて型にだけ用意しており、OGT の値から自動で設定してはならない。
 */
export type Scope2Basis = 'unknown' | 'location_based' | 'market_based';

/**
 * Scope 2 の排出量を、適用した係数の種別で分けた内訳（t-CO2e）。
 * OGT が持つのは温対法の「基礎排出係数 / 調整後排出係数」の区分で、1 年度の中で混在しうる。
 * 基準不明の値を読む人が、どちらの係数で算定されたかを確認できるように添える。
 */
export type OgtFactorTypeBreakdown = {
  /** 基礎排出係数で算定した分。 */
  basic: SsbjDecimalString;
  /** 調整後排出係数で算定した分。 */
  adjusted: SsbjDecimalString;
  /** 区分を持たない係数（カスタム係数など）で算定した分。 */
  unclassified: SsbjDecimalString;
};

// 採用方式。OGT に実在する区分だけで表す。サプライヤー別実排出量は OGT の合計に入らない
// 参考値のため方式には含めない（OgtSupplierReference）。

/** Scope 1: 活動量 × 係数。 */
export type OgtScope1Method = { kind: 'activity_based' };

/** Scope 2: 活動量 × 係数。基準は OGT からは分からないため scope2Basis を必ず添える。 */
export type OgtScope2Method = {
  kind: 'activity_based';
  scope2Basis: Scope2Basis;
  factorTypeBreakdown: OgtFactorTypeBreakdown | null;
};

/** Scope 3 カテゴリ: scope3_category_methods の direct（直接入力）/ calculated（積上げ）。 */
export type OgtScope3CategoryMethod = { kind: 'direct' } | { kind: 'calculated' };

/** Scope 3 合計: カテゴリごとに方式が異なるため per_category。 */
export type OgtScope3TotalMethod = { kind: 'per_category' };

/**
 * 算定の充足状態。未算定・データ不足を数値 0 と区別するために持つ。判定は
 * utils/ogtValue.ts の deriveOgtDataQuality に一本化している（規則は docs/ssbj-spec.md §7）。
 * all_calculated は「登録済みのレコードがすべて算定済み」という意味で、
 * システムに未入力のデータまでは検知できないため「網羅的」を意味しない。
 */
export type OgtDataQuality = 'all_calculated' | 'partially_calculated' | 'not_calculated';

/** 算定済み / 未算定のレコード件数（report_*_calculation_coverage RPC の件数）。 */
export type OgtCalculationCoverage = {
  calculatedCount: number;
  uncalculatedCount: number;
};

/** OGT の算定バッチ状態（BatchStatus）。 */
export type OgtBatchStatus = 'pending' | 'completed' | 'failed';

/** 値が OGT のどこから来たか。クライアントから送られた値を OGT 由来と認めないための根拠。 */
export type OgtValueSource = {
  kind: 'ogt';
  /** 参照した集計。Scope 別合計は dashboard_aggregates、Scope 3 カテゴリ別は RPC の採用値。 */
  aggregate: 'dashboard_aggregates' | 'dashboard_scope3_category_emissions' | 'scope3_category_emissions';
  /** 集計行の更新日時（dashboard_aggregates.updatedAt 等）。集計行が無ければ null。 */
  aggregateUpdatedAt: string | null;
  /** 取得時点の最新の算定バッチ。completed 以外の状態もそのまま残す。 */
  latestBatch: { id: string; status: OgtBatchStatus; completedAt: string | null } | null;
};

type OgtCandidateValueCommon = {
  /** 排出量。not_calculated のときは必ず unanswered（0 を入れない）。 */
  value: SsbjFieldValue<SsbjDecimalString>;
  unit: typeof OGT_EMISSION_UNIT;
  fiscalYearId: string;
  /** 対象期間（算定年度の期間。YYYY-MM-DD）。 */
  period: { startDate: string; endDate: string };
  boundary: OgtBoundary;
  dataQuality: OgtDataQuality;
  /** 充足状態の判定に使った件数。直接入力のカテゴリなど件数で判定しない値は null。 */
  coverage: OgtCalculationCoverage | null;
  source: OgtValueSource;
};

/**
 * OGT から取得した候補値（T08a）。Scope ごとに持てる方式を型で制限する。
 * scope3CategoryId が null の Scope 3 は Scope 3 合計。
 */
export type OgtCandidateValue = OgtCandidateValueCommon &
  (
    | { scope: 1; scope3CategoryId: null; method: OgtScope1Method }
    | { scope: 2; scope3CategoryId: null; method: OgtScope2Method }
    | { scope: 3; scope3CategoryId: number; method: OgtScope3CategoryMethod }
    | { scope: 3; scope3CategoryId: null; method: OgtScope3TotalMethod }
  );

/** 利用者が明示的に採用した OGT 値（T08b が保存版へ固定する）。 */
export type OgtAdoptedValue = OgtCandidateValue & {
  adoptedAt: string;
  adoptedBy: string;
};

/**
 * レポートに採用した OGT の値一式（T08b。ssbj_ogt_adoptions の 1 行）。Scope 1・2・3 合計と Scope 3 の
 * 15 カテゴリをまとめて採用する（合計とカテゴリ別の値を同じ時点にそろえるため）。
 * 採用日時・採用者は DB が付ける。サプライヤー別の値は参考値で、合計には足さない。
 */
export type SsbjGhgAdoption = {
  adoptedAt: string;
  adoptedBy: string;
  values: OgtAdoptedValue[];
  supplierReferences: OgtSupplierReference[];
};

/**
 * サプライヤー別実排出量（supplier_emissions）。OGT では表示専用で scope3Total に算入していないため、
 * 採用値とは別の型にして合計へ足せないようにする（二重加算の防止）。
 */
export type OgtSupplierReference = {
  kind: 'supplier_reference';
  fiscalYearId: string;
  scope3CategoryId: number;
  supplierId: string;
  supplierName: string;
  emissions: SsbjDecimalString;
  unit: typeof OGT_EMISSION_UNIT;
};

// ---------------------------------------------------------------------------
// リスク・機会（T07）
// ---------------------------------------------------------------------------

/** リスクか機会か。 */
export const SSBJ_RISK_OPPORTUNITY_KINDS = ['risk', 'opportunity'] as const;

export type SsbjRiskOpportunityKind = (typeof SSBJ_RISK_OPPORTUNITY_KINDS)[number];

export const SSBJ_RISK_OPPORTUNITY_KIND_LABELS: Record<SsbjRiskOpportunityKind, string> = {
  risk: 'リスク',
  opportunity: '機会',
};

/**
 * リスクの種類（気候関連開示基準 第19項(2)。識別したリスクごとに開示する）。機会には持たない。
 * DB は check 制約で持つ（区分を変えるときは制約を張り替える）。
 */
export const SSBJ_RISK_TYPES = ['physical', 'transition'] as const;

export type SsbjRiskType = (typeof SSBJ_RISK_TYPES)[number];

export const SSBJ_RISK_TYPE_LABELS: Record<SsbjRiskType, string> = {
  physical: '物理的リスク',
  transition: '移行リスク',
};

/**
 * 時間軸の区分（気候関連開示基準 第19項(3)。短期・中期・長期で表す）。
 * 各区分が何年を指すかはレポートごとの定義（SsbjTimeHorizonDefinitions）で持つ。
 * DB は check 制約で持つ（区分を変えるときは制約を張り替える）。
 */
export const SSBJ_TIME_HORIZONS = ['short_term', 'medium_term', 'long_term'] as const;

export type SsbjTimeHorizon = (typeof SSBJ_TIME_HORIZONS)[number];

export const SSBJ_TIME_HORIZON_LABELS: Record<SsbjTimeHorizon, string> = {
  short_term: '短期',
  medium_term: '中期',
  long_term: '長期',
};

/**
 * リスク・機会の関連先。章だけに関連付けるなら章 ID、項目まで決まっていれば項目 ID。
 * 章と項目を別々に持たないのは、項目 ID の接頭辞と食い違わせないため（§3。章は sectionOfItem で導出する）。
 */
export type SsbjLinkTarget = SsbjSectionId | SsbjItemId;

/** 項目に紐付く根拠文書の参照情報。保管先などは開示文と分けて保持する。 */
export type SsbjEvidence = {
  id: string;
  itemId: SsbjItemId;
  documentTitle: string;
  documentVersion: string | null;
  internalLocation: string | null;
  referencePosition: string | null;
  ownerDepartment: string | null;
  disclosure: SsbjFieldValue<string>;
};

/** リスク・機会 1 件。複数登録できる。 */
export type SsbjRiskOpportunity = {
  id: string;
  kind: SsbjRiskOpportunityKind;
  /** 名称（必須）。 */
  title: string;
  /** リスクの種類。機会は分類しないため `not_applicable`（旧データは `unanswered` のこともある）。 */
  riskType: SsbjFieldValue<SsbjRiskType>;
  /** 開示する説明と内部メモ（§5）。 */
  description: SsbjDisclosableText;
  timeHorizon: SsbjFieldValue<SsbjTimeHorizon>;
  /** 関連する章・項目（章の順、同じ章では章そのものを先に並べる）。 */
  linkTargets: SsbjLinkTarget[];
};

/**
 * レポートとしての時間軸の定義（気候関連開示基準 第19項(4)(5)、一般開示基準 第14項(3)(4)）。
 * 「短期」「中期」「長期」がそれぞれ何を指すかと、その定義と戦略上の計画期間との関係。
 */
export type SsbjTimeHorizonDefinitions = {
  shortTerm: SsbjFieldValue<string>;
  mediumTerm: SsbjFieldValue<string>;
  longTerm: SsbjFieldValue<string>;
  planningHorizonRelation: SsbjFieldValue<string>;
  /** 内部の検討メモ。開示しない（§5）。 */
  internalNote: string | null;
};

// ---------------------------------------------------------------------------
// 保存版（T06 が生成し、T11 / T12 / T13 が読む）
// ---------------------------------------------------------------------------

/**
 * 保存版に含める各機能のデータ。キーは DB 関数 ssbj_snapshot_section__<key> の <key> と一致させる。
 * 各機能は自分のセクションのキーと型をここへ追記する。
 */
export interface SsbjSnapshotSections {
  /** T07。ssbj_snapshot_section__risks_opportunities。作成順。 */
  risks_opportunities: SsbjRiskOpportunity[];
  /** T07。ssbj_snapshot_section__time_horizons。定義の行が無いレポートは全て未入力。 */
  time_horizons: SsbjTimeHorizonDefinitions;
  /** T10。ssbj_snapshot_section__evidence。項目ID・作成順。 */
  evidence: SsbjEvidence[];
  /** T08b。ssbj_snapshot_section__ghg。OGT の値を採用していないレポートは null。 */
  ghg: SsbjGhgAdoption | null;
  /** T05。ssbj_snapshot_section__narratives。項目 ID の順。行の無い項目は含まない（表示側で未入力とする）。 */
  narratives: SsbjNarrative[];
  /** T09。ssbj_snapshot_section__judgements。要求 ID の順。行の無い要求は含まない（表示側で未確認とする）。 */
  judgements: SsbjJudgement[];
}

/** 保存版の中身（ssbj_report_versions.snapshot）。形式を変えるときは schemaVersion を上げる。 */
export type SsbjReportSnapshotV1 = {
  schemaVersion: 1;
  /** 任意項目を足す前に保存した版では、その項目のキーが無い。読む側は欠落を null と同じく未入力と扱う。 */
  report: SsbjReportRecord;
  sections: Partial<SsbjSnapshotSections>;
};

/** 保存版。作成後は書き換えない（過去版からの新版作成も新しい行として作る）。 */
export type SsbjReportVersion = {
  id: SsbjVersionId;
  reportId: SsbjReportId;
  /** レポート内の連番（1 始まり）。 */
  versionNumber: number;
  snapshot: SsbjReportSnapshotV1;
  /** スナップショットの元になった作業状態。過去版からの複製では元版の値を引き継ぐ。 */
  basedOnDraftRevision: number;
  /** 過去版から作った場合の元の版。通常の保存では null。 */
  sourceVersionId: SsbjVersionId | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// 操作履歴（ssbj_audit_logs。docs/ssbj-spec.md §13）
// ---------------------------------------------------------------------------

export const SSBJ_AUDIT_ACTIONS = [
  'create', 'update', 'delete', 'status_change', 'version_create', 'version_restore', 'export',
] as const;

export type SsbjAuditAction = (typeof SSBJ_AUDIT_ACTIONS)[number];

/** 操作履歴の 1 件（誰が・いつ・何をしたか）。DB のトリガーと RPC が書き、書き換えない。 */
export type SsbjAuditLog = {
  id: number;
  reportId: SsbjReportId;
  actorUserId: string | null;
  action: SsbjAuditAction;
  /** report / narrative / judgement / risk_opportunity / time_horizons / evidence / ogt_adoption / version */
  targetType: string;
  targetId: string | null;
  changedColumns: string[] | null;
  details: Record<string, unknown>;
  createdAt: string;
};

/** ファイルの出力形式（操作履歴・出力履歴に残す）。 */
export const SSBJ_EXPORT_FORMATS = ['csv', 'xlsx', 'audit_csv', 'audit_xlsx'] as const;

export type SsbjExportFormat = (typeof SSBJ_EXPORT_FORMATS)[number];
