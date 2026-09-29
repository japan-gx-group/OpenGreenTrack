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
  /** T08b。ssbj_snapshot_section__ghg。OGT の値を採用していないレポートは null。 */
  ghg: SsbjGhgAdoption | null;
}

/** 保存版の中身（ssbj_report_versions.snapshot）。形式を変えるときは schemaVersion を上げる。 */
export type SsbjReportSnapshotV1 = {
  schemaVersion: 1;
  report: SsbjReportRecord;
  sections: Partial<SsbjSnapshotSections>;
};

/** 保存版。作成後は書き換えない（過去版からの復元も新しい版として作る）。 */
export type SsbjReportVersion = {
  id: SsbjVersionId;
  reportId: SsbjReportId;
  /** レポート内の連番（1 始まり）。 */
  versionNumber: number;
  snapshot: SsbjReportSnapshotV1;
  /** どの作業状態（ssbj_reports.draftRevision）から作った版か。 */
  basedOnDraftRevision: number;
  /** 過去版から作った場合の元の版。通常の保存では null。 */
  sourceVersionId: SsbjVersionId | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
};
