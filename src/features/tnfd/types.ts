// TNFD 開示レポート（試行版 R1）の共通データ契約。
//
// レポート作成・文章・コア指標・拠点の自然関連情報・判断・根拠・保存版・プレビュー・CSV の各機能が、
// 同じ識別子・値の状態・保存形式でつながるための型をここに集める。仕様の正本は docs/tnfd-spec.md。
// SSBJ 開示レポート（src/features/ssbj/types.ts）の設計を踏襲し、意味が同じ型は SSBJ のものを
// そのまま import する（値の状態・十進文字列・開示文と内部記録の区分・OGT の候補値と採用値）。
// TNFD にしか無いもの（章 ID・指標・拠点の自然関連情報・ISSB 公開草案の受け皿）だけをここで定義する。
//
// R1 は社内確認用の試行版であり、TNFD 提言への準拠や対外提出を保証するものではない。

import type {
  OgtAdoptedValue,
  OgtCandidateValue,
  SsbjDecimalString,
  SsbjDisclosableText,
  SsbjFieldState,
  SsbjFieldValue,
} from '@/features/ssbj/types';

// ---------------------------------------------------------------------------
// SSBJ と同じ意味で使う型（別名を付けて TNFD の文脈で読めるようにする。中身は同一）
// ---------------------------------------------------------------------------

/** 値の状態。DB の enum は ssbj_field_state を参照する（TNFD 用に別の enum を作らない。docs/tnfd-spec.md §4）。 */
export type TnfdFieldState = SsbjFieldState;

/** 状態つきの値。値を持てるのは `answered` のときだけ。 */
export type TnfdFieldValue<T> = SsbjFieldValue<T>;

/** 十進表記の数値文字列。number に変換しない（docs/tnfd-spec.md §6）。 */
export type TnfdDecimalString = SsbjDecimalString;

/** 開示する文章と内部記録を別のプロパティ（DB では別の列）で持つ文章（docs/tnfd-spec.md §5）。 */
export type TnfdDisclosableText = SsbjDisclosableText;

export type { OgtAdoptedValue, OgtCandidateValue };

// ---------------------------------------------------------------------------
// 識別子（docs/tnfd-spec.md §3）
// ---------------------------------------------------------------------------

/**
 * 章（四本柱）の ID。TNFD の柱は「リスクとインパクトの管理」で SSBJ の「リスク管理」と中身が違うため、
 * SSBJ の `risk_management` とは意図的に別の値にする（横断で見るときに取り違えないため）。
 */
export const TNFD_SECTION_IDS = [
  'governance',
  'strategy',
  'risk_impact_management',
  'metrics_targets',
] as const;

export type TnfdSectionId = (typeof TNFD_SECTION_IDS)[number];

/** 章の表示ラベル（画面・プレビュー・CSV で共通）。TNFD 提言の語に合わせる。 */
export const TNFD_SECTION_LABELS: Record<TnfdSectionId, string> = {
  governance: 'ガバナンス',
  strategy: '戦略',
  risk_impact_management: 'リスクとインパクトの管理',
  metrics_targets: '指標と目標',
};

/**
 * 項目 ID。`<章ID>.<slug>`（slug は英小文字・数字・アンダースコア）。
 * アプリ内の安定キーであり、提言のラベル（Governance A など）ではない。提言のラベルや ISSB 草案の段落は
 * 要求項目マスターの別の列で持つ（改訂で変わっても ID を変えずに済むようにするため）。
 */
export type TnfdItemId = `${TnfdSectionId}.${string}`;

/** 要求 ID の基準コード。TNFD = TNFD 開示提言（October 2026）/ ISSB = ISSB 実務記述書（公開草案）。 */
export const TNFD_STANDARD_CODES = ['TNFD', 'ISSB'] as const;

export type TnfdStandardCode = (typeof TNFD_STANDARD_CODES)[number];

export const TNFD_STANDARD_LABELS: Record<TnfdStandardCode, string> = {
  TNFD: 'TNFD 開示提言',
  ISSB: 'ISSB 自然関連開示（公開草案）',
};

/** 要求 ID。`REQ-<基準コード>-<3桁連番>`（例 `REQ-TNFD-001`）。形式の検証は utils/ids.ts。 */
export type TnfdRequirementId = `REQ-${TnfdStandardCode}-${string}`;

/**
 * 指標 ID。英小文字始まりの slug（例 `ghg_scope1` / `water_withdrawal`）。
 * TNFD のコード（C2.0 など）は ID に埋め込まない。2026年10月の改訂で暫定だったコードが確定・変更された
 * （C4.0 / C5.0 / C5.1 / C5.2）ように、コードは版で変わりうる。コードは指標マスターの別の列で持つ。
 */
export type TnfdMetricId = string;

/** レポート ID（tnfd_reports.id。DB が生成する UUID）。 */
export type TnfdReportId = string;

/** 保存版 ID（tnfd_report_versions.id。DB が生成する UUID）。 */
export type TnfdVersionId = string;

// ---------------------------------------------------------------------------
// 要求項目マスター（データは utils/requirementMaster.ts）
// ---------------------------------------------------------------------------

/**
 * 提言・段落の参照（例 `{ standard: 'TNFD', paragraphs: 'Governance A' }`）。本文は持たない（docs/tnfd-spec.md §1）。
 * TNFD のラベルは October 2026 版、ISSB は公開草案（ED-2026-10）で確認したものを書く。
 */
export type TnfdParagraphReference = {
  standard: TnfdStandardCode;
  paragraphs: string;
};

/**
 * 要求にどこで答えるか。narrative は四本柱の文章の項目、metric はコア指標、location は拠点の自然関連情報。
 * notice は利用者の入力ではなく、プレビュー・出力の注記で扱うもの（OGT が対応していない要求など）。
 */
export type TnfdRequirementInputTarget =
  | { kind: 'narrative'; itemId: TnfdItemId }
  | { kind: 'basic_info' }
  | { kind: 'metric'; metricIds: TnfdMetricId[] }
  | { kind: 'location' }
  | { kind: 'notice' };

/** 要求項目マスターの 1 行（提言・草案が求めること 1 つ）。 */
export type TnfdRequirement = {
  id: TnfdRequirementId;
  /** 属する章。一般要件など章にまたがる全般の要求は null。 */
  sectionId: TnfdSectionId | null;
  /** 要求の要約（提言の本文ではなく、この試行版の言葉で書く）。 */
  summary: string;
  references: TnfdParagraphReference[];
  inputTarget: TnfdRequirementInputTarget;
  /** 記載ガイド（何を書くか・OGT の制約・「していない」場合の書き方）。専門家の画面レビューで確定する。 */
  guide: string;
};

/**
 * 四本柱の文章の項目。1 つの項目で複数の要求に答えられる（TNFD の提言と ISSB 草案の同じ趣旨の要求を
 * 二重に入力しないため）。company_supplement は要求に対応しない企業固有の補足。
 * issb_placeholder は ISSB 公開草案の新要求の受け皿で、TNFD の 14 提言とは別の見出しで出す（docs/tnfd-spec.md §10）。
 */
export type TnfdNarrativeItem = {
  id: TnfdItemId;
  kind: 'requirement' | 'company_supplement' | 'issb_placeholder';
  label: string;
  requirementIds: TnfdRequirementId[];
  /** 記載例（架空の会社の文例）。 */
  example: string;
};

/** 四本柱・一般要件・企業固有の補足の文章 1 項目（tnfd_narratives の 1 行）。 */
export type TnfdNarrative = {
  itemId: TnfdItemId;
  text: TnfdDisclosableText;
};

// ---------------------------------------------------------------------------
// コア指標（docs/tnfd-spec.md §8。データは utils/metricMaster.ts）
// ---------------------------------------------------------------------------

/** 指標の分類。TNFD の自然への影響ドライバーに沿った並び（October 2026 版で要確認）。 */
export const TNFD_METRIC_CATEGORIES = [
  'climate_change',
  'land_freshwater_ocean_use_change',
  'resource_use',
  'pollution',
  'invasive_species',
  'state_of_nature',
  'risk_opportunity',
] as const;

export type TnfdMetricCategory = (typeof TNFD_METRIC_CATEGORIES)[number];

export const TNFD_METRIC_CATEGORY_LABELS: Record<TnfdMetricCategory, string> = {
  climate_change: '気候変動',
  land_freshwater_ocean_use_change: '陸・淡水・海洋の利用変化',
  resource_use: '資源利用',
  pollution: '汚染',
  invasive_species: '侵略的外来種',
  state_of_nature: '自然の状態',
  risk_opportunity: 'リスク・機会',
};

/**
 * 指標の入力種別。auto = OGT の採用値（GHG）/ manual_number = 数値＋単位＋補足文 / manual_text = 文章のみ。
 */
export type TnfdMetricInputKind = 'auto' | 'manual_number' | 'manual_text';

/** 指標マスターの 1 行。 */
export type TnfdMetricDefinition = {
  id: TnfdMetricId;
  /** TNFD のコード（October 2026 版。版で変わりうるため ID にしない。未確認は null）。 */
  tnfdCode: string | null;
  category: TnfdMetricCategory;
  label: string;
  /** 既定の単位。文章のみの指標は null。 */
  unit: string | null;
  /** 利用者が単位を変えられるか。 */
  unitSelectable: boolean;
  inputKind: TnfdMetricInputKind;
  /** R1 で入力欄を出すか。専門家の選定で確定する（docs/tnfd-spec.md §8.1・U-2）。false でもマスターから消さない。 */
  enabledInR1: boolean;
  /** 記載ガイド。 */
  guide: string;
  requirementIds: TnfdRequirementId[];
};

/**
 * 集計範囲。R1 は組織全体のみ。将来の拡張は 2 軸（自然の側＝拠点別・生態系タイプ別、会社の側＝法人別）で、
 * どちらも種類を足すだけで R1 の値は読める（docs/tnfd-spec.md §7.3・§8.2）。
 */
export type TnfdMetricBoundary = { kind: 'organization' };

/** 手入力値の出所。将来の外部データ連携は kind を足すだけにする（docs/tnfd-spec.md §8.2）。 */
export type TnfdMetricValueSource =
  | { kind: 'manual'; enteredByUserId: string; enteredAt: string }
  | { kind: 'ogt' };

/** コア指標の値 1 件（tnfd_metric_values の 1 行。GHG の採用値は別に OgtAdoptedValue で持つ）。 */
export type TnfdMetricValue = {
  metricId: TnfdMetricId;
  /** manual_text の指標は文字列、それ以外は十進文字列。 */
  value: TnfdFieldValue<TnfdDecimalString | string>;
  /** 保存時の単位（マスターの既定値を複写。unitSelectable のときだけ変更可）。文章のみの指標は null。 */
  unit: string | null;
  boundary: TnfdMetricBoundary;
  /** 算定方法の説明（開示文と内部記録）。 */
  method: TnfdDisclosableText;
  source: TnfdMetricValueSource;
};

// ---------------------------------------------------------------------------
// 拠点の自然関連情報（戦略D。docs/tnfd-spec.md §9）
// ---------------------------------------------------------------------------

/** センシティブロケーション該当有無。既定は未判定（ソフトは判断しない）。 */
export const TNFD_LOCATION_SENSITIVITIES = ['unassessed', 'sensitive', 'not_sensitive'] as const;

export type TnfdLocationSensitivity = (typeof TNFD_LOCATION_SENSITIVITIES)[number];

export const TNFD_LOCATION_SENSITIVITY_LABELS: Record<TnfdLocationSensitivity, string> = {
  unassessed: '未判定',
  sensitive: '該当あり',
  not_sensitive: '該当なし',
};

/**
 * 拠点 1 件の自然関連情報（tnfd_location_assessments の 1 行）。位置情報は locations の列から読むが、
 * 保存版には拠点名・住所・緯度経度を複写して固定する（拠点マスターが後で変わっても版を再現するため）。
 */
export type TnfdLocationAssessment = {
  locationId: string;
  locationName: string;
  address: string | null;
  /** 緯度（-90〜90）。任意入力。 */
  latitude: TnfdDecimalString | null;
  /** 経度（-180〜180）。任意入力。 */
  longitude: TnfdDecimalString | null;
  sensitivity: TnfdLocationSensitivity;
  /** 判定根拠（開示文と内部記録）。 */
  basis: TnfdDisclosableText;
};

// ---------------------------------------------------------------------------
// レポートの基本情報
// ---------------------------------------------------------------------------

/**
 * レポートの基本情報。組織と算定年度に必ず結び付く。必須はレポート名だけで、ほかは任意（未入力は null）。
 * 親会社との関係・測定アプローチ・業種は R1 では持たない（法人別集計の列は U-10 で後から SSBJ と同名で足す）。
 */
export type TnfdReportBasicInfo = {
  id: TnfdReportId;
  organizationId: string;
  fiscalYearId: string;
  title: string;
  purpose: string | null;
  /** 対象範囲の説明（例: 単体 / 主要な事業所）。 */
  reportingScope: string | null;
  /** 準拠した文書の版の表記（例: TNFD Recommendations, October 2026）。 */
  standardVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 基本情報に算定年度の表示情報を添えたもの。画面と保存版の report で共通。 */
export type TnfdReportRecord = TnfdReportBasicInfo & {
  fiscalYearLabel: string;
  periodStart: string;
  periodEnd: string;
};

/** 画面が編集中に持つレポート。draftRevision で保存競合を検知する（docs/tnfd-spec.md §11）。 */
export type TnfdReportWorkingRecord = TnfdReportRecord & {
  draftRevision: number;
};

// ---------------------------------------------------------------------------
// 保存版（docs/tnfd-spec.md §11・§13）
// ---------------------------------------------------------------------------

/**
 * 固定版のセクション。各機能が tnfd_snapshot_section__<key> を定義して自動収集される（docs/tnfd-spec.md §13）。
 * キーは関数名の <key> と一致させる。
 */
export interface TnfdSnapshotSections {
  /** TN-04。tnfd_snapshot_section__narratives。項目 ID の順。行の無い項目は含まない（表示側で未入力とする）。 */
  narratives: TnfdNarrative[];
  /** TN-05。tnfd_snapshot_section__metrics。手入力指標は指標 ID の順、GHG は採用値（採用していなければ null）。 */
  metrics: { values: TnfdMetricValue[]; ghg: OgtAdoptedValue[] | null };
  /** TN-06。tnfd_snapshot_section__location_assessments。拠点名の順。 */
  location_assessments: TnfdLocationAssessment[];
}

/** 保存版の中身。形式を変えるときは schemaVersion を上げ、読む側で旧形式も読めるようにする。 */
export type TnfdReportSnapshotV1 = {
  schemaVersion: 1;
  report: TnfdReportRecord;
  sections: Partial<TnfdSnapshotSections>;
};

/** 保存版。作成後は書き換えない（過去版からの新版作成も新しい行として作る）。 */
export type TnfdReportVersion = {
  id: TnfdVersionId;
  reportId: TnfdReportId;
  /** レポート内の連番（1 始まり）。 */
  versionNumber: number;
  snapshot: TnfdReportSnapshotV1;
  basedOnDraftRevision: number;
  sourceVersionId: TnfdVersionId | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
};
