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
  type SsbjRiskType,
  type SsbjTimeHorizon,
} from '../types';
import { fromFieldValue, toFieldValue } from '../utils/fieldValue';
import type { SsbjRiskOpportunityInput } from '../utils/riskOpportunity';
import { ssbjWriteErrorMessage } from '../utils/writeError';

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

const SELECT_COLUMNS =
  'id, kind, title, riskTypeState, riskType, descriptionState, descriptionText, internalNote, ' +
  'timeHorizonState, timeHorizon, linkTargets';

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
export const listSsbjRisksOpportunities = async (reportId: string): Promise<SsbjRiskOpportunity[]> => {
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
  return ((data ?? []) as unknown as SsbjRiskOpportunityRow[]).map(toSsbjRiskOpportunity);
};

/** 登録。組織はレポートの組織を渡す（レポートの組織帰属は RLS の with check が検証する）。 */
export const createSsbjRiskOpportunity = async (
  report: { id: string; organizationId: string },
  input: SsbjRiskOpportunityInput,
): Promise<SsbjRiskOpportunity> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_risks_opportunities')
    .insert({ ...toSsbjRiskOpportunityColumns(input), organizationId: report.organizationId, reportId: report.id })
    .select(SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(ssbjWriteErrorMessage(error, 'リスク・機会の登録に失敗しました'));
  }
  return toSsbjRiskOpportunity(data as unknown as SsbjRiskOpportunityRow);
};

/** 更新。レポート・組織は変更できない（列 GRANT で内容の列だけを許可している）。 */
export const updateSsbjRiskOpportunity = async (
  id: string,
  input: SsbjRiskOpportunityInput,
): Promise<SsbjRiskOpportunity> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('ssbj_risks_opportunities')
    .update(toSsbjRiskOpportunityColumns(input))
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(ssbjWriteErrorMessage(error, 'リスク・機会の更新に失敗しました'));
  }
  if (!data) {
    // RLS で対象が見えない（削除済み・他組織）場合は 0 件更新になる。
    throw new Error('リスク・機会が見つかりません。画面を開き直してください');
  }
  return toSsbjRiskOpportunity(data as unknown as SsbjRiskOpportunityRow);
};

/** 削除。 */
export const deleteSsbjRiskOpportunity = async (id: string): Promise<void> => {
  const supabase = createClient();
  const { error } = await supabase.from('ssbj_risks_opportunities').delete().eq('id', id);
  if (error) {
    throw new Error(ssbjWriteErrorMessage(error, 'リスク・機会の削除に失敗しました'));
  }
};
