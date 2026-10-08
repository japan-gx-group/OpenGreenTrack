// SSBJ レポート（ssbj_reports）の取得・作成・基本情報の更新サービス。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。
// 例外は fetchSsbjReport で、クライアントを引数で受け取るため、サーバからはサーバ用クライアントを渡して呼べる。
// 組織分離は RLS が強制する（他組織のレポートは select で 0 件になり、他組織の年度を指す insert は拒否される）。
// DB の行（年度を埋め込んだ形）と画面・保存版で使う SsbjReportRecord の相互変換もここで行う。

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type {
  SsbjMeasurementApproach,
  SsbjParentRelationship,
  SsbjReportRecord,
  SsbjReportStatus,
  SsbjReportWorkingRecord,
} from '../types';
import type { SsbjReportBasicInfoInput } from '../utils/reportValidation';
import { ssbjWriteErrorMessage } from '../utils/writeError';

type FiscalYearEmbed = { label: string; startDate: string; endDate: string };

export interface SsbjReportRow {
  id: string;
  organizationId: string;
  fiscalYearId: string;
  title: string;
  purpose: string | null;
  reportingScope: string | null;
  standardVersion: string | null;
  parentCompanyName: string | null;
  parentRelationship: string | null;
  /** 十進表記の文字列（select で text に変換して受け取る）。 */
  ownershipPercentage: string | null;
  measurementApproach: string | null;
  industryCode: string | null;
  createdAt: string;
  updatedAt: string;
  draftRevision: number;
  status: string;
  approverUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  approvedVersionId: string | null;
  statusChangedAt: string | null;
  // 多対一の埋め込みはオブジェクトで返るが、型生成の揺れに備えて配列でも受ける。
  fiscal_years: FiscalYearEmbed | FiscalYearEmbed[] | null;
}

// 年度のラベルと期間は fiscal_years を埋め込んで同じ往復で取る（一覧の各行に年度名を出すため）。
// draftRevision も同じ往復で取る。別の問い合わせにすると、表示した内容より新しい版数を保持してしまい、
// 画面に出ていない変更を含む保存版を競合として検知できなくなる。
// 持分比率（numeric）は text に変換して受け取る。number にすると桁の表記が揺れるため（docs/ssbj-spec.md §6）。
const SELECT_COLUMNS =
  'id, organizationId, fiscalYearId, title, purpose, reportingScope, standardVersion, ' +
  'parentCompanyName, parentRelationship, ownershipPercentage::text, measurementApproach, industryCode, ' +
  'createdAt, updatedAt, draftRevision, status, approverUserId, approvedAt, approvedByUserId, approvedVersionId, ' +
  'statusChangedAt, fiscal_years(label, startDate, endDate)';

/** DB 行 → SsbjReportRecord。年度が見えない行（通常は起こらない）は例外にする。 */
export const toSsbjReportRecord = (row: SsbjReportRow): SsbjReportRecord => {
  const fiscalYear = Array.isArray(row.fiscal_years) ? row.fiscal_years[0] : row.fiscal_years;
  if (!fiscalYear) {
    throw new Error('レポートの算定年度を取得できませんでした');
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    fiscalYearId: row.fiscalYearId,
    title: row.title,
    purpose: row.purpose,
    reportingScope: row.reportingScope,
    standardVersion: row.standardVersion,
    parentCompanyName: row.parentCompanyName,
    // 値の形式は DB の check 制約が保証している。
    parentRelationship: row.parentRelationship as SsbjParentRelationship | null,
    ownershipPercentage: row.ownershipPercentage,
    measurementApproach: row.measurementApproach as SsbjMeasurementApproach | null,
    industryCode: row.industryCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    fiscalYearLabel: fiscalYear.label,
    periodStart: fiscalYear.startDate,
    periodEnd: fiscalYear.endDate,
  };
};

/** DB 行 → 編集画面用のレコード（保存版作成の競合検知に使う draftRevision と、状態・承認の記録を添える）。 */
export const toSsbjReportWorkingRecord = (row: SsbjReportRow): SsbjReportWorkingRecord => ({
  ...toSsbjReportRecord(row),
  draftRevision: row.draftRevision,
  review: {
    // 値の形式は DB の check 制約が保証している。
    status: row.status as SsbjReportStatus,
    approverUserId: row.approverUserId,
    approvedAt: row.approvedAt,
    approvedByUserId: row.approvedByUserId,
    approvedVersionId: row.approvedVersionId,
    statusChangedAt: row.statusChangedAt,
  },
});

// ログイン中ユーザーの所属組織ID。insert 時に組織を明示する必要がある（RLS の with check と一致させる）。
// locationService.ts / targetService.ts と同じ手順。
const getCurrentOrganizationId = async (supabase: SupabaseClient): Promise<string> => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('ログイン情報が確認できませんでした。再度ログインしてください');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('organizationId')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    throw new Error('所属組織を特定できませんでした');
  }
  return data.organizationId as string;
};

/** 指定年度のレポート一覧（新しい順。状態を添える）。RLS により自組織の行だけが返る。 */
export const listSsbjReports = async (fiscalYearId: string): Promise<SsbjReportWorkingRecord[]> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_reports')
    .select(SELECT_COLUMNS)
    .eq('fiscalYearId', fiscalYearId)
    .order('createdAt', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    throw new Error('SSBJレポートの取得に失敗しました');
  }
  return ((data ?? []) as unknown as SsbjReportRow[]).map(toSsbjReportWorkingRecord);
};

/**
 * 1 件取得。存在しない・他組織（RLS で不可視）のレポートは null を返し、
 * 「見つかりません」表示にして他組織のレポートの存在を示唆しない。
 */
export const getSsbjReport = async (reportId: string): Promise<SsbjReportWorkingRecord | null> =>
  fetchSsbjReport(createClient(), reportId);

/**
 * getSsbjReport の本体。渡したクライアントの RLS で読むため、サーバ（Route Handler）からはセッションを引き継いだ
 * サーバ用クライアントを渡す（他組織のレポートは null になる）。
 */
export const fetchSsbjReport = async (
  supabase: SupabaseClient,
  reportId: string,
): Promise<SsbjReportWorkingRecord | null> => {
  const { data, error } = await supabase
    .from('ssbj_reports')
    .select(SELECT_COLUMNS)
    .eq('id', reportId)
    .maybeSingle();

  if (error) {
    // URL 直打ちなどで UUID 形式でない ID（22P02: invalid_text_representation）は「存在しない」として扱う。
    if (error.code === '22P02') return null;
    throw new Error('SSBJレポートの取得に失敗しました');
  }
  return data ? toSsbjReportWorkingRecord(data as unknown as SsbjReportRow) : null;
};

/** 新規作成。組織はログインユーザーの所属組織から解決する（年度の組織帰属は RLS が検証する）。 */
export const createSsbjReport = async (
  fiscalYearId: string,
  input: SsbjReportBasicInfoInput,
): Promise<SsbjReportWorkingRecord> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { data, error } = await supabase
    .from('ssbj_reports')
    .insert({ ...input, organizationId, fiscalYearId })
    .select(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('SSBJレポートの作成に失敗しました');
  }
  return toSsbjReportWorkingRecord(data as unknown as SsbjReportRow);
};

/**
 * 基本情報の更新。組織・年度は変更できない（列 GRANT で基本情報の列だけを許可している）。
 * 値が変わると DB のトリガーが draftRevision を進めるため、更新後の版数を返して画面の保持値を差し替えさせる。
 */
export const updateSsbjReportBasicInfo = async (
  reportId: string,
  input: SsbjReportBasicInfoInput,
): Promise<SsbjReportWorkingRecord> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_reports')
    .update(input)
    .eq('id', reportId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(ssbjWriteErrorMessage(error, 'SSBJレポートの更新に失敗しました'));
  }
  if (!data) {
    // RLS で対象が見えない（削除済み・他組織）場合は 0 件更新になる。
    throw new Error('SSBJレポートが見つかりません。一覧から開き直してください');
  }
  return toSsbjReportWorkingRecord(data as unknown as SsbjReportRow);
};
