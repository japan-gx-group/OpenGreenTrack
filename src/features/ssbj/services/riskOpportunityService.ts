// リスク・機会（ssbj_risks_opportunities）の取得・登録・更新・削除サービス。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。
// 組織分離は RLS が強制する（他組織の行は select で 0 件、他組織のレポートへの insert は拒否される）。
// 変更のたびに DB のトリガーが ssbj_reports.draftRevision を進める（docs/ssbj-spec.md §8）。

import { createClient } from '@/lib/supabase/client';
import {
  SSBJ_RISK_OPPORTUNITY_KINDS,
  type SsbjLinkTarget,
  type SsbjRiskOpportunity,
  type SsbjRiskOpportunityKind,
  type SsbjRiskOpportunityWorkingRecord,
  type SsbjRiskType,
  type SsbjTimeHorizon,
} from '../types';
import { fromFieldValue, toFieldValue } from '../utils/fieldValue';
import type { SsbjRiskOpportunityInput } from '../utils/riskOpportunity';
import { SsbjEditConflictError, ssbjWriteErrorMessage } from '../utils/writeError';

export interface SsbjRiskOpportunityRow {
  id: string;
  kind: string;
  title: string;
  riskTypeState: string;
  riskType: string | null;
  descriptionState: string;
  descriptionText: string | null;
  internalNote: string | null;
  timeHorizonState: string;
  timeHorizon: string | null;
  linkTargets: string[];
}

/** 画面が編集中に持つ行（更新の競合検知に使う updatedAt を添える）。 */
export type SsbjRiskOpportunityWorkingRow = SsbjRiskOpportunityRow & { updatedAt: string };

// updatedAt は文字列のまま受け取り、そのまま更新の条件に渡す（Date に変換するとマイクロ秒が落ちて一致しなくなる）。
const SELECT_COLUMNS =
  'id, kind, title, riskTypeState, riskType, descriptionState, descriptionText, internalNote, ' +
  'timeHorizonState, timeHorizon, linkTargets, updatedAt';

const isKind = (value: string): value is SsbjRiskOpportunityKind =>
  (SSBJ_RISK_OPPORTUNITY_KINDS as readonly string[]).includes(value);

/**
 * DB 行 → SsbjRiskOpportunity。状態と値が食い違う行は toFieldValue が例外にする
 * （黙って補正すると、未入力が空文字として保存版に残る経路になるため）。
 */
export const toSsbjRiskOpportunity = (row: SsbjRiskOpportunityRow): SsbjRiskOpportunity => {
  if (!isKind(row.kind)) {
    throw new Error(`不明なリスク・機会の区分です: ${row.kind}`);
  }
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    // 値の形式（physical / transition）は DB の check 制約が保証している。
    riskType: toFieldValue<SsbjRiskType>(row.riskTypeState, row.riskType as SsbjRiskType | null),
    description: {
      disclosure: toFieldValue<string>(row.descriptionState, row.descriptionText),
      internalNote: row.internalNote,
    },
    timeHorizon: toFieldValue<SsbjTimeHorizon>(row.timeHorizonState, row.timeHorizon as SsbjTimeHorizon | null),
    // 形式は DB の check 制約が保証している。
    linkTargets: row.linkTargets as SsbjLinkTarget[],
  };
};

/** DB 行 → 編集画面用のレコード（更新の競合検知に使う updatedAt を添える）。 */
export const toSsbjRiskOpportunityWorkingRecord = (
  row: SsbjRiskOpportunityWorkingRow,
): SsbjRiskOpportunityWorkingRecord => ({
  ...toSsbjRiskOpportunity(row),
  updatedAt: row.updatedAt,
});

/** SsbjRiskOpportunityInput → 書き込む列（状態列＋値列の対に分解する）。 */
export const toSsbjRiskOpportunityColumns = (input: SsbjRiskOpportunityInput) => {
  const riskType = fromFieldValue(input.riskType);
  const description = fromFieldValue(input.description.disclosure);
  const timeHorizon = fromFieldValue(input.timeHorizon);
  return {
    kind: input.kind,
    title: input.title,
    riskTypeState: riskType.state,
    riskType: riskType.value,
    descriptionState: description.state,
    descriptionText: description.value,
    internalNote: input.description.internalNote,
    timeHorizonState: timeHorizon.state,
    timeHorizon: timeHorizon.value,
    linkTargets: input.linkTargets,
  };
};

/** レポートのリスク・機会（登録順）。RLS により自組織の行だけが返る。 */
export const listSsbjRisksOpportunities = async (reportId: string): Promise<SsbjRiskOpportunityWorkingRecord[]> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_risks_opportunities')
    .select(SELECT_COLUMNS)
    .eq('reportId', reportId)
    .order('createdAt', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw new Error('リスク・機会の取得に失敗しました');
  }
  return ((data ?? []) as unknown as SsbjRiskOpportunityWorkingRow[]).map(toSsbjRiskOpportunityWorkingRecord);
};

/** 登録。組織はレポートの組織を渡す（レポートの組織帰属は RLS の with check が検証する）。 */
export const createSsbjRiskOpportunity = async (
  report: { id: string; organizationId: string },
  input: SsbjRiskOpportunityInput,
): Promise<SsbjRiskOpportunityWorkingRecord> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_risks_opportunities')
    .insert({ ...toSsbjRiskOpportunityColumns(input), organizationId: report.organizationId, reportId: report.id })
    .select(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(ssbjWriteErrorMessage(error, 'リスク・機会の登録に失敗しました'));
  }
  return toSsbjRiskOpportunityWorkingRecord(data as unknown as SsbjRiskOpportunityWorkingRow);
};

/**
 * 更新。レポート・組織は変更できない（列 GRANT で内容の列だけを許可している）。
 *
 * target.updatedAt は編集を始めた時点の行の更新日時。更新の条件に含め、他の画面が先に同じ行を保存していれば
 * 0 件更新になるので、SsbjEditConflictError で拒否する（先に保存された変更を古い値で上書きしない）。
 * 条件と更新は 1 つの UPDATE 文なので、比べた直後に別の保存が入る隙間は無い（docs/ssbj-spec.md §8）。
 * 行の updatedAt を使うのは、同じレポートの他の行や文章・判断の変更では変わらず、無関係な編集を競合にしないため。
 */
export const updateSsbjRiskOpportunity = async (
  target: Pick<SsbjRiskOpportunityWorkingRecord, 'id' | 'updatedAt'>,
  input: SsbjRiskOpportunityInput,
): Promise<SsbjRiskOpportunityWorkingRecord> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_risks_opportunities')
    .update(toSsbjRiskOpportunityColumns(input))
    .eq('id', target.id)
    .eq('updatedAt', target.updatedAt)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(ssbjWriteErrorMessage(error, 'リスク・機会の更新に失敗しました'));
  }
  if (!data) {
    // 0 件更新: 行が更新された（競合）か、削除済み・RLS で見えない。見えるかどうかで分ける。
    const { data: current, error: currentError } = await supabase
      .from('ssbj_risks_opportunities')
      .select('id')
      .eq('id', target.id)
      .maybeSingle();
    if (currentError) {
      throw new Error('リスク・機会の更新に失敗しました');
    }
    if (current) {
      throw new SsbjEditConflictError();
    }
    throw new Error('リスク・機会が見つかりません。画面を開き直してください');
  }
  return toSsbjRiskOpportunityWorkingRecord(data as unknown as SsbjRiskOpportunityWorkingRow);
};

/** 削除。 */
export const deleteSsbjRiskOpportunity = async (id: string): Promise<void> => {
  const supabase = createClient();
  const { error } = await supabase.from('ssbj_risks_opportunities').delete().eq('id', id);
  if (error) {
    throw new Error(ssbjWriteErrorMessage(error, 'リスク・機会の削除に失敗しました'));
  }
};
