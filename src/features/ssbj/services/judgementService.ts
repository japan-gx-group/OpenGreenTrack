// 該当性・重要性・記載しない理由（ssbj_judgements。レポートと要求の組ごとに 1 行）の取得・保存サービス（T09）。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。組織分離は RLS が強制する。
// 変更のたびに DB のトリガーが ssbj_reports.draftRevision を進める（docs/ssbj-spec.md §8）。

import { createClient } from '@/lib/supabase/client';
import {
  SSBJ_APPLICABILITIES,
  SSBJ_MATERIALITIES,
  SSBJ_OMISSION_REASONS,
  type SsbjJudgement,
  type SsbjRequirementId,
} from '../types';
import { fromFieldValue, toFieldValue } from '../utils/fieldValue';
import { ssbjWriteErrorMessage } from '../utils/writeError';

type SsbjJudgementRow = {
  requirementId: string;
  applicability: string;
  materiality: string;
  omissionReason: string;
  explanationState: string;
  explanationText: string | null;
  internalReason: string | null;
};

const SELECT_COLUMNS =
  'requirementId, applicability, materiality, omissionReason, explanationState, explanationText, internalReason';

const oneOf = <T extends string>(values: readonly T[], value: string, name: string): T => {
  if (!(values as readonly string[]).includes(value)) throw new Error(`${name}の値が不正です: ${value}`);
  return value as T;
};

/** DB 行 → 判断。区分の値や状態と値が食い違う行は例外にする（黙って補正しない）。 */
export const toSsbjJudgement = (row: SsbjJudgementRow): SsbjJudgement => ({
  requirementId: row.requirementId as SsbjRequirementId,
  applicability: oneOf(SSBJ_APPLICABILITIES, row.applicability, '該当性'),
  materiality: oneOf(SSBJ_MATERIALITIES, row.materiality, '重要性'),
  omissionReason: oneOf(SSBJ_OMISSION_REASONS, row.omissionReason, '記載しない理由'),
  explanation: {
    disclosure: toFieldValue<string>(row.explanationState, row.explanationText),
    internalNote: row.internalReason,
  },
});

const toColumns = (judgement: SsbjJudgement) => {
  const explanation = fromFieldValue(judgement.explanation.disclosure);
  return {
    applicability: judgement.applicability,
    materiality: judgement.materiality,
    omissionReason: judgement.omissionReason,
    explanationState: explanation.state,
    explanationText: explanation.value,
    internalReason: judgement.explanation.internalNote,
  };
};

/** レポートの判断（要求 ID の順）。行の無い要求は含まない。 */
export const listSsbjJudgements = async (reportId: string): Promise<SsbjJudgement[]> => {
  const { data, error } = await createClient()
    .from('ssbj_judgements')
    .select(SELECT_COLUMNS)
    .eq('reportId', reportId)
    .order('requirementId');
  if (error) throw new Error('該当性・重要性の判断の取得に失敗しました');
  return ((data ?? []) as SsbjJudgementRow[]).map(toSsbjJudgement);
};

/**
 * 1 要求の判断を保存する。行があれば更新し、無ければ作る。
 * upsert にしないのは、PostgREST が衝突時の更新に reportId / organizationId / requirementId も含めるため
 * （3 列は作成後に変えない前提で update の列 GRANT に入れていない。narrativeService と同じ）。
 */
export const saveSsbjJudgement = async (
  report: { id: string; organizationId: string },
  judgement: SsbjJudgement,
): Promise<SsbjJudgement> => {
  const supabase = createClient();
  const columns = toColumns(judgement);

  const updated = await supabase
    .from('ssbj_judgements')
    .update(columns)
    .eq('reportId', report.id)
    .eq('requirementId', judgement.requirementId)
    .select(SELECT_COLUMNS);
  if (updated.error) throw new Error(ssbjWriteErrorMessage(updated.error, '該当性・重要性の判断の保存に失敗しました'));
  const updatedRows = (updated.data ?? []) as SsbjJudgementRow[];
  if (updatedRows.length > 0) return toSsbjJudgement(updatedRows[0]);

  const inserted = await supabase
    .from('ssbj_judgements')
    .insert({
      ...columns,
      reportId: report.id,
      organizationId: report.organizationId,
      requirementId: judgement.requirementId,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (inserted.error || !inserted.data) {
    // 23505: 別の画面・別の人が同時に同じ要求の最初の判断を作った。
    if (inserted.error?.code === '23505') {
      throw new Error('他の画面で先に保存されました。画面を開き直してから保存し直してください');
    }
    throw new Error(ssbjWriteErrorMessage(inserted.error, '該当性・重要性の判断の保存に失敗しました'));
  }
  return toSsbjJudgement(inserted.data as SsbjJudgementRow);
};
