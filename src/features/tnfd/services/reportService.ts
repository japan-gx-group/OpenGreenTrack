// TNFD レポート（tnfd_reports）の取得・作成・基本情報の更新サービス。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。
// 組織分離は RLS が強制する（他組織のレポートは select で 0 件になり、他組織の年度を指す insert は拒否される）。
// DB の行（年度を埋め込んだ形）と画面・保存版で使う TnfdReportRecord の相互変換もここで行う。

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { TnfdReportRecord } from '../types';
import type { TnfdReportBasicInfoInput } from '../utils/reportValidation';

type FiscalYearEmbed = { label: string; startDate: string; endDate: string };

export interface TnfdReportRow {
  id: string;
  organizationId: string;
  fiscalYearId: string;
  title: string;
  purpose: string | null;
  reportingScope: string | null;
  standardVersion: string | null;
  createdAt: string;
  updatedAt: string;
  // 多対一の埋め込みはオブジェクトで返るが、型生成の揺れに備えて配列でも受ける。
  fiscal_years: FiscalYearEmbed | FiscalYearEmbed[] | null;
}

// 年度のラベルと期間は fiscal_years を埋め込んで同じ往復で取る（一覧の各行に年度名を出すため）。
const SELECT_COLUMNS =
  'id, organizationId, fiscalYearId, title, purpose, reportingScope, standardVersion, createdAt, updatedAt, ' +
  'fiscal_years(label, startDate, endDate)';

/** DB 行 → TnfdReportRecord。年度が見えない行（通常は起こらない）は例外にする。 */
export const toTnfdReportRecord = (row: TnfdReportRow): TnfdReportRecord => {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    fiscalYearLabel: fiscalYear.label,
    periodStart: fiscalYear.startDate,
    periodEnd: fiscalYear.endDate,
  };
};

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

/** 指定年度のレポート一覧（新しい順）。RLS により自組織の行だけが返る。 */
export const listTnfdReports = async (fiscalYearId: string): Promise<TnfdReportRecord[]> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('tnfd_reports')
    .select(SELECT_COLUMNS)
    .eq('fiscalYearId', fiscalYearId)
    .order('createdAt', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    throw new Error('TNFDレポートの取得に失敗しました');
  }
  return ((data ?? []) as unknown as TnfdReportRow[]).map(toTnfdReportRecord);
};

/**
 * 1 件取得。存在しない・他組織（RLS で不可視）のレポートは null を返し、
 * 「見つかりません」表示にして他組織のレポートの存在を示唆しない。
 */
export const getTnfdReport = async (reportId: string): Promise<TnfdReportRecord | null> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('tnfd_reports')
    .select(SELECT_COLUMNS)
    .eq('id', reportId)
    .maybeSingle();

  if (error) {
    // URL 直打ちなどで UUID 形式でない ID（22P02: invalid_text_representation）は「存在しない」として扱う。
    if (error.code === '22P02') return null;
    throw new Error('TNFDレポートの取得に失敗しました');
  }
  return data ? toTnfdReportRecord(data as unknown as TnfdReportRow) : null;
};

/**
 * 新規作成。組織はログインユーザーの所属組織から解決する（年度の組織帰属は RLS が検証する）。
 * TNFD レポートは組織 × 算定年度につき 1 件（unique 制約。docs/tnfd-spec.md §2）。
 * 2 件目の作成は 23505（unique_violation）になるため、固有のメッセージで案内する。
 */
export const createTnfdReport = async (
  fiscalYearId: string,
  input: TnfdReportBasicInfoInput,
): Promise<TnfdReportRecord> => {
  const supabase = createClient();
  const organizationId = await getCurrentOrganizationId(supabase);

  const { data, error } = await supabase
    .from('tnfd_reports')
    .insert({ ...input, organizationId, fiscalYearId })
    .select(SELECT_COLUMNS)
    .single();

  if (error?.code === '23505') {
    throw new Error('この年度のTNFDレポートは既に作成されています（年度につき1件）。一覧から開いてください');
  }
  if (error || !data) {
    throw new Error('TNFDレポートの作成に失敗しました');
  }
  return toTnfdReportRecord(data as unknown as TnfdReportRow);
};

/** 基本情報の更新。組織・年度は変更できない（列 GRANT で基本情報の列だけを許可している）。 */
export const updateTnfdReportBasicInfo = async (
  reportId: string,
  input: TnfdReportBasicInfoInput,
): Promise<TnfdReportRecord> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('tnfd_reports')
    .update(input)
    .eq('id', reportId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error('TNFDレポートの更新に失敗しました');
  }
  if (!data) {
    // RLS で対象が見えない（削除済み・他組織）場合は 0 件更新になる。
    throw new Error('TNFDレポートが見つかりません。一覧から開き直してください');
  }
  return toTnfdReportRecord(data as unknown as TnfdReportRow);
};
