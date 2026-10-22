// 1 つの組織に属するデータの一覧（組織のデータの件数の確認・書き出し・削除の対象）。
// 手順は docs/backup-restore-and-data-return.md、使うのは scripts/ops/org-data.ts。
//
// public スキーマにテーブルを足したら、ここにも足す（組織に属さないテーブルなら SHARED_TABLES に理由と一緒に足す）。
// scripts/ops/__tests__/orgDataTables.test.ts が supabase/migrations の create table と照らし合わせ、漏れを検出する。
//
// 削除は organizations の行を消し、外部キーの連鎖削除（on delete cascade）で各テーブルの行を消す。
// 連鎖削除で消えない行（on delete restrict の system_audit_logs）は、org-data.ts が先に消す。
// どのテーブルも削除の後に「この組織の行が 0 件」「ほかの組織の行が変わっていない」を確かめる。

export type OrgDataTable = {
  /** public スキーマのテーブル名。 */
  name: string;
  /** この組織の行を選ぶ列（organizations だけは id）。値が null の行（全組織で共通の行）は含まない。 */
  organizationColumn: 'organizationId' | 'id';
  /** 主キー。書き出し・チェックサムの並びを毎回同じにするために使う。 */
  primaryKey: string[];
  /** 書き出さない列（認証に使う値など。組織に返す必要が無く、渡すと危ない）。件数・削除の対象には含める。 */
  omitColumns?: string[];
};

/** 組織に属するテーブル（OGT 本体と SSBJ）。並びは書き出しのファイルと表示の順。 */
export const ORG_DATA_TABLES: readonly OrgDataTable[] = [
  // OGT 本体
  { name: 'organizations', organizationColumn: 'id', primaryKey: ['id'], omitColumns: ['apiKeyHash'] },
  { name: 'profiles', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'invites', organizationColumn: 'organizationId', primaryKey: ['token'], omitColumns: ['token'] },
  { name: 'fiscal_years', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'locations', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'suppliers', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'emission_factors', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'idea_imports', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'idea_factors', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'activity_records', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'calculation_batches', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'emission_results', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'dashboard_aggregates', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'scope3_category_emissions', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'scope3_category_methods', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'supplier_emissions', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'reduction_targets', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'reduction_target_years', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'system_audit_logs', organizationColumn: 'organizationId', primaryKey: ['id'] },
  // SSBJ
  { name: 'ssbj_reports', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'ssbj_report_versions', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'ssbj_report_time_horizons', organizationColumn: 'organizationId', primaryKey: ['reportId'] },
  { name: 'ssbj_risks_opportunities', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'ssbj_evidence', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'ssbj_ogt_adoptions', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'ssbj_narratives', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'ssbj_judgements', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'ssbj_risk_candidate_decisions', organizationColumn: 'organizationId', primaryKey: ['id'] },
  { name: 'ssbj_member_roles', organizationColumn: 'organizationId', primaryKey: ['organizationId', 'userId'] },
  { name: 'ssbj_audit_logs', organizationColumn: 'organizationId', primaryKey: ['id'] },
];

/**
 * public スキーマのうち、組織に属さないテーブル（書き出し・削除の対象にしない）と、その理由。
 * 今は無い。全組織で共通のマスタ（公式の排出係数など）は、organizationId が null の行として上の表に含まれる。
 */
export const SHARED_TABLES: Readonly<Record<string, string>> = {};
