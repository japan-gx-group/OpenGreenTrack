// 外部で算定した排出量（外部算定値）の作業中データ。ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。
// 組織分離・レポートと根拠文書の帰属・確認者の組織・ロール（入力担当か管理者）は DB の RLS で検証する。
// 二重計上（OGT の採用値・ほかの外部算定値と重なる）は、DB がトランザクションの最後に拒否する（P2071 / P2072）。

import { createClient } from '@/lib/supabase/client';
import {
  OGT_EMISSION_UNIT,
  type SsbjExternalEmission,
  type SsbjGhgGas,
  type SsbjScope2Basis,
} from '../types';
import type { SsbjExternalEmissionInput } from '../utils/externalEmission';
import { ssbjWriteErrorMessage } from '../utils/writeError';

type SsbjExternalEmissionRow = {
  id: string;
  scope: number;
  scope3CategoryId: number | null;
  scope2Basis: string | null;
  gases: string[];
  value: string;
  unit: string;
  periodStart: string;
  periodEnd: string;
  calculatedBy: string;
  calculationMethod: string;
  evidenceId: string;
  confirmedByUserId: string;
  confirmedAt: string;
  internalNote: string | null;
};

// 排出量（numeric）は text に変換して受け取る（number にすると桁の表記が揺れるため。§6）。
const SELECT_COLUMNS =
  'id, scope, scope3CategoryId, scope2Basis, gases, value::text, unit, periodStart, periodEnd, calculatedBy, ' +
  'calculationMethod, evidenceId, confirmedByUserId, confirmedAt, internalNote';

/** 外部算定値に固有の SQLSTATE（supabase/migrations/20261010130000_ssbj_external_emissions.sql）。 */
export const SSBJ_EXTERNAL_EMISSION_SQLSTATE = {
  /** OGT の採用値と重なる（同じ Scope・カテゴリの CO2） */
  overlapsOgt: 'P2071',
  /** ほかの外部算定値と重なる（同じ Scope・カテゴリ・基準で同じガス） */
  overlapsExternal: 'P2072',
} as const;

/** DB 行 → 外部算定値（値の形式は DB の制約が保証している）。 */
export const toSsbjExternalEmission = (row: SsbjExternalEmissionRow): SsbjExternalEmission => ({
  id: row.id,
  scope: row.scope as 1 | 2 | 3,
  scope3CategoryId: row.scope3CategoryId,
  scope2Basis: row.scope2Basis as SsbjScope2Basis | null,
  gases: row.gases as SsbjGhgGas[],
  value: row.value,
  unit: OGT_EMISSION_UNIT,
  period: { startDate: row.periodStart, endDate: row.periodEnd },
  calculatedBy: row.calculatedBy,
  calculationMethod: row.calculationMethod,
  evidenceId: row.evidenceId,
  confirmedByUserId: row.confirmedByUserId,
  confirmedAt: row.confirmedAt,
  internalNote: row.internalNote,
});

const toColumns = (input: SsbjExternalEmissionInput) => ({
  scope: input.scope,
  scope3CategoryId: input.scope3CategoryId,
  scope2Basis: input.scope2Basis,
  gases: input.gases,
  value: input.value,
  unit: OGT_EMISSION_UNIT,
  periodStart: input.period.startDate,
  periodEnd: input.period.endDate,
  calculatedBy: input.calculatedBy,
  calculationMethod: input.calculationMethod,
  evidenceId: input.evidenceId,
  confirmedByUserId: input.confirmedByUserId,
  confirmedAt: input.confirmedAt,
  internalNote: input.internalNote,
});

/** 書き込みの失敗を、利用者向けのメッセージにする（重なりは DB のメッセージをそのまま出す）。 */
export const externalEmissionErrorMessage = (
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
): string => {
  if (error?.code === SSBJ_EXTERNAL_EMISSION_SQLSTATE.overlapsOgt || error?.code === SSBJ_EXTERNAL_EMISSION_SQLSTATE.overlapsExternal) {
    return error.message ?? fallback;
  }
  return ssbjWriteErrorMessage(error, fallback);
};

/** 更新・削除が 0 件だったときの、考えられる理由（RLS で止められた操作はエラーにならず 0 件になる）。 */
const NOT_CHANGED_REASON = '他の画面で削除されたか、SSBJ のロールが変わった可能性があります';

export const listSsbjExternalEmissions = async (reportId: string): Promise<SsbjExternalEmission[]> => {
  const { data, error } = await createClient()
    .from('ssbj_external_emissions')
    .select(SELECT_COLUMNS)
    .eq('reportId', reportId)
    .order('scope')
    .order('scope3CategoryId', { nullsFirst: true })
    .order('createdAt');
  if (error) throw new Error('外部算定値の取得に失敗しました');
  return ((data ?? []) as unknown as SsbjExternalEmissionRow[]).map(toSsbjExternalEmission);
};

export const createSsbjExternalEmission = async (
  report: { id: string; organizationId: string },
  input: SsbjExternalEmissionInput,
): Promise<SsbjExternalEmission> => {
  const { data, error } = await createClient()
    .from('ssbj_external_emissions')
    .insert({ ...toColumns(input), reportId: report.id, organizationId: report.organizationId })
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) throw new Error(externalEmissionErrorMessage(error, '外部算定値の保存に失敗しました'));
  return toSsbjExternalEmission(data as unknown as SsbjExternalEmissionRow);
};

export const updateSsbjExternalEmission = async (
  id: string,
  input: SsbjExternalEmissionInput,
): Promise<SsbjExternalEmission> => {
  const { data, error } = await createClient()
    .from('ssbj_external_emissions')
    .update(toColumns(input))
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(externalEmissionErrorMessage(error, '外部算定値の保存に失敗しました'));
  if (!data) throw new Error(`外部算定値を保存できませんでした（${NOT_CHANGED_REASON}）。画面を開き直してください`);
  return toSsbjExternalEmission(data as unknown as SsbjExternalEmissionRow);
};

/**
 * 外部算定値を削除する。削除した行を返させ、0 件なら例外にする（呼び出し元は一覧から外さない）。
 * RLS で止められた削除はエラーにならず 0 件になるため（画面を開いた後に承認担当・閲覧者に変えられた場合など）、
 * エラーだけを見ると、DB に残っている値を画面から消してしまう。
 */
export const deleteSsbjExternalEmission = async (id: string): Promise<void> => {
  const { data, error } = await createClient().from('ssbj_external_emissions').delete().eq('id', id).select('id');
  if (error) throw new Error(externalEmissionErrorMessage(error, '外部算定値の削除に失敗しました'));
  if (!data?.length) throw new Error(`外部算定値を削除できませんでした（${NOT_CHANGED_REASON}）。画面を開き直してください`);
};
