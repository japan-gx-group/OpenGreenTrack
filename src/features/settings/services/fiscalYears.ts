'use server';

// 会計年度（fiscal_years）の追加用 Server Action（管理画面から年度を足せるようにする）。
//
// なぜ service_role（admin client）を使うか:
//   fiscal_years は organizationId を持つ組織別マスタだが、authenticated には
//   書き込み GRANT が無い（supabase/migrations/20260831000001_rls.sql の fiscal_years は
//   grant select のみ・書き込みポリシー無し）ため、追加・削除は service_role 経由になる。
//
// ロールによる絞り込みは行わない（認証済みユーザーは同一権限として扱う）。ただし service_role は
// RLS を越えるため、対象を Cookie セッションから引いた caller.organizationId の年度に
// 限定する処理（各クエリの organizationId 条件）はここでしか担保できない。消さないこと。

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentProfile } from '@/lib/currentProfile';
import {
  deriveFiscalYearPeriod,
  formatFiscalYearPeriod,
  normalizeFiscalYearStartMonth,
} from '@/lib/fiscal-year/fiscalYearPeriod';
import type { ActionResult } from '@/types/actionResult';

// fiscalYearId を参照している全テーブル（削除の可否判定に使う）。
// calculation_batches / reduction_targets / dashboard_aggregates は
// on delete cascade のため、参照が残ったまま年度を消すとその年度のデータが連鎖削除される。
// supplier_emissions / scope3_category_methods は cascade 無しの FK（残っていると削除自体が失敗する）。
// scope3_category_emissions は fiscalYearId に FK が無い（残ったまま年度を消すと孤児行になる）。
// いずれにせよ「参照データが1件でもあれば削除させない」ことで全パターンを安全側で塞ぐ。
// column は年度を指す外部キー名。reduction_targets だけは「基準年度」を指すため列名が異なる。
// 年度を参照するテーブルを増やしたら必ずここにも足すこと。
const REFERENCING_TABLES = [
  { table: 'calculation_batches', column: 'fiscalYearId', label: '算定バッチ' },
  { table: 'reduction_targets', column: 'baseFiscalYearId', label: '削減目標' },
  { table: 'dashboard_aggregates', column: 'fiscalYearId', label: 'ダッシュボード集計' },
  { table: 'supplier_emissions', column: 'fiscalYearId', label: '供給者別排出データ' },
  { table: 'scope3_category_emissions', column: 'fiscalYearId', label: 'Scope3 直接入力' },
  { table: 'scope3_category_methods', column: 'fiscalYearId', label: 'Scope3 算定方法' },
] as const;

// 指定年度を参照しているデータ種別のラベル一覧（存在するものだけ）を返す。
// service_role で読むが、削除判定は必ず操作者の organizationId に絞る。
// これにより、万一同じ fiscalYearId が別組織データから参照される不整合があっても、
// 操作者が他組織データの有無を知る経路を作らない。
const findReferencingData = async (
  admin: SupabaseClient,
  fiscalYearId: string,
  organizationId: string,
): Promise<string[]> => {
  const results = await Promise.all(
    REFERENCING_TABLES.map(async ({ table, column, label }): Promise<string | null> => {
      const { data, error } = await admin
        .from(table)
        .select('id')
        .eq(column, fiscalYearId)
        .eq('organizationId', organizationId)
        .limit(1);
      if (error) throw new Error(`参照データの確認に失敗しました（${table}）`);
      return (data?.length ?? 0) > 0 ? label : null;
    }),
  );
  return results.filter((value): value is string => value !== null);
};

export interface AddFiscalYearInput {
  /** 会計年度の開始年（例: 2026 → 期首月に応じた2026年度）。 */
  startYear: number;
}

export interface FiscalYearUsage {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  /** この年度に紐づく参照データ（算定・目標等）があるか。true なら削除不可。 */
  hasData: boolean;
}

export interface FiscalYearCreated {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface FiscalYearManagementData {
  /** 会社情報の期首月。未設定や不正値は4月に正規化して返す。 */
  fiscalYearStartMonth: number;
  years: FiscalYearUsage[];
}

const getOrganizationFiscalYearStartMonth = async (
  admin: SupabaseClient,
  organizationId: string,
): Promise<number> => {
  const { data, error } = await admin
    .from('organizations')
    .select('fiscalYearStartMonth')
    .eq('id', organizationId)
    .single();

  if (error || !data) {
    throw new Error('算定年度の開始月の取得に失敗しました');
  }

  return normalizeFiscalYearStartMonth((data as { fiscalYearStartMonth: number | null }).fiscalYearStartMonth);
};

export const addFiscalYear = async (
  input: AddFiscalYearInput,
): Promise<ActionResult<FiscalYearCreated>> => {
  const caller = await getCurrentProfile();
  if (!caller) {
    return { ok: false, error: 'セッションが確認できません。ログインし直してください' };
  }

  const startYear = Number(input.startYear);
  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100) {
    return { ok: false, error: '年度は2000〜2100の範囲で指定してください' };
  }

  const admin = createAdminClient();
  let fiscalYearStartMonth: number;
  try {
    fiscalYearStartMonth = await getOrganizationFiscalYearStartMonth(admin, caller.organizationId);
  } catch {
    return { ok: false, error: '算定年度の開始月の取得に失敗しました' };
  }
  const { label, startDate, endDate } = deriveFiscalYearPeriod(startYear, fiscalYearStartMonth);

  // 重複ガード: 同じ組織に同じ「年度」が既にあれば追加しない。
  // 期間（startDate/endDate）一致だけでは不十分。期首月を 4月→7月 に変えた後に同じ開始年を
  // 追加すると期間は違うのに label が同じ「2026年度」の行が2本でき、年度セレクタに同名の
  // 年度が並ぶうえ、年度IDを渡さない経路（前年度比較・予測の遡り）がどちらの期間を指すか
  // 決まらなくなるため、開始年（＝ラベル）でも重複を弾く。
  const { data: existingYears, error: existingError } = await admin
    .from('fiscal_years')
    .select('id, label, startDate, endDate')
    .eq('organizationId', caller.organizationId);
  if (existingError) {
    return { ok: false, error: '既存年度の確認に失敗しました' };
  }
  const existingPeriods = (existingYears ?? []) as {
    label: string;
    startDate: string;
    endDate: string;
  }[];

  const duplicate = existingPeriods.find(
    row => row.startDate.slice(0, 4) === String(startYear) || row.label === label,
  );
  if (duplicate) {
    return {
      ok: false,
      error: `${label}は既に登録されています（登録済みの期間: ${formatFiscalYearPeriod(duplicate.startDate, duplicate.endDate)}）`,
    };
  }

  // 期間の重複ガード: 開始年もラベルも違うのに期間が部分的に重なる年度は作らせない。
  // 期首月は会社情報から変更できるため、例えば 2026年度（2026-04〜2027-03）がある組織で
  // 期首月を 1月 に変えて 2027年度（2027-01〜2027-12）を足すと 1〜3月が両方の年度に入る。
  // 年度への帰属は活動量の期間開始日で決まるので、重なった月のレコードは両年度の年次サマリ
  // （dashboard_aggregates）・データ充足状況・拠点別表に計上され、組織全体の年度合計が
  // 警告も無く二重計上になる。重なりは追加時にしか作れないため、ここで塞ぐ。
  // 期間は 'YYYY-MM-DD' の固定桁なので文字列比較がそのまま日付の大小になる。
  const overlapping = existingPeriods
    .filter(row => startDate <= row.endDate && endDate >= row.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (overlapping.length > 0) {
    const overlappingText = overlapping
      .map(row => `${row.label}: ${formatFiscalYearPeriod(row.startDate, row.endDate)}`)
      .join('、');
    return {
      ok: false,
      error: `${label}（${formatFiscalYearPeriod(startDate, endDate)}）は既に登録されている年度と期間が重なります（${overlappingText}）。期首月を変更した場合は、重なる年度を削除してから追加してください`,
    };
  }

  // 画面の既定表示は「最新年度」を見るため、追加した年度が最新であれば自動的に既定になる。
  // 「現在」の表示は今日の日付から導出するので、ここで立てるフラグは無い。
  const { data, error } = await admin
    .from('fiscal_years')
    .insert({
      organizationId: caller.organizationId,
      label,
      startDate,
      endDate,
    })
    .select('id, label, startDate, endDate')
    .single();
  if (error || !data) {
    return { ok: false, error: '年度の追加に失敗しました' };
  }

  return {
    ok: true,
    data: {
      id: data.id as string,
      label: data.label as string,
      startDate: data.startDate as string,
      endDate: data.endDate as string,
    },
  };
};

// 年度一覧を、各年度に参照データがあるか（hasData）付きで返す。
// hasData の年度は削除できない（画面側で削除ボタンを無効化する）。
export const listFiscalYearsWithUsage = async (): Promise<ActionResult<FiscalYearManagementData>> => {
  const caller = await getCurrentProfile();
  if (!caller) {
    return { ok: false, error: 'セッションが確認できません。ログインし直してください' };
  }

  const admin = createAdminClient();
  let fiscalYearStartMonth: number;
  try {
    fiscalYearStartMonth = await getOrganizationFiscalYearStartMonth(admin, caller.organizationId);
  } catch {
    return { ok: false, error: '算定年度の開始月の取得に失敗しました' };
  }

  const { data, error } = await admin
    .from('fiscal_years')
    .select('id, label, startDate, endDate')
    .eq('organizationId', caller.organizationId)
    .order('startDate', { ascending: false });
  if (error || !data) {
    return { ok: false, error: '年度一覧の取得に失敗しました' };
  }

  try {
    const rows = await Promise.all(
      (data as { id: string; label: string; startDate: string; endDate: string }[]).map(
        async (row) => ({
          id: row.id,
          label: row.label,
          startDate: row.startDate,
          endDate: row.endDate,
          hasData: (await findReferencingData(admin, row.id, caller.organizationId)).length > 0,
        }),
      ),
    );
    return { ok: true, data: { fiscalYearStartMonth, years: rows } };
  } catch {
    return { ok: false, error: '参照データの確認に失敗しました' };
  }
};

// 年度の削除。参照データ（算定・目標・供給者データ等）が1件でもあれば削除しない（ガード）。
// 破壊的な cascade 削除を防ぐため、削除直前にサーバ側で再チェックする（画面の状態は信用しない）。
export const deleteFiscalYear = async (id: string): Promise<ActionResult> => {
  const caller = await getCurrentProfile();
  if (!caller) {
    return { ok: false, error: 'セッションが確認できません。ログインし直してください' };
  }
  if (!id) {
    return { ok: false, error: '対象の年度が指定されていません' };
  }

  const admin = createAdminClient();
  const { data: fiscalYear, error: fiscalYearError } = await admin
    .from('fiscal_years')
    .select('id')
    .eq('id', id)
    .eq('organizationId', caller.organizationId)
    .maybeSingle();
  if (fiscalYearError) {
    return { ok: false, error: '年度の確認に失敗しました' };
  }
  if (!fiscalYear) {
    return { ok: false, error: '対象の年度が見つからないか、削除権限がありません' };
  }

  let referencing: string[];
  try {
    referencing = await findReferencingData(admin, id, caller.organizationId);
  } catch {
    return { ok: false, error: '参照データの確認に失敗しました' };
  }
  if (referencing.length > 0) {
    return {
      ok: false,
      error: `この年度には${referencing.join('・')}が紐づいているため削除できません。先にそれらのデータを削除してください。`,
    };
  }

  const { error } = await admin
    .from('fiscal_years')
    .delete()
    .eq('id', id)
    .eq('organizationId', caller.organizationId);
  if (error) {
    return { ok: false, error: '年度の削除に失敗しました' };
  }
  return { ok: true, data: undefined };
};
