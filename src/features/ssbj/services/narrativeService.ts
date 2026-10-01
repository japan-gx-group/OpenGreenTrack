// 四本柱・企業固有の補足の文章（ssbj_narratives。レポートと項目の組ごとに 1 行）の取得・保存サービス（T05）。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。組織分離は RLS が強制する。
// 変更のたびに DB のトリガーが ssbj_reports.draftRevision を進める（docs/ssbj-spec.md §8）。

import { createClient } from '@/lib/supabase/client';
import type { SsbjDisclosableText, SsbjItemId, SsbjNarrative } from '../types';
import { ssbjWriteErrorMessage } from '../utils/writeError';
import { fromFieldValue, toFieldValue } from '../utils/fieldValue';

type SsbjNarrativeRow = {
  itemId: string;
  disclosureState: string;
  disclosureText: string | null;
  internalNote: string | null;
};

const SELECT_COLUMNS = 'itemId, disclosureState, disclosureText, internalNote';

/** DB 行 → 文章。状態と値が食い違う行は toFieldValue が例外にする（黙って補正しない）。 */
export const toSsbjNarrative = (row: SsbjNarrativeRow): SsbjNarrative => ({
  itemId: row.itemId as SsbjItemId,
  text: {
    disclosure: toFieldValue<string>(row.disclosureState, row.disclosureText),
    internalNote: row.internalNote,
  },
});

const toColumns = (text: SsbjDisclosableText) => {
  const disclosure = fromFieldValue(text.disclosure);
  return { disclosureState: disclosure.state, disclosureText: disclosure.value, internalNote: text.internalNote };
};

/** レポートの文章（項目 ID の順）。行の無い項目は含まない。 */
export const listSsbjNarratives = async (reportId: string): Promise<SsbjNarrative[]> => {
  const { data, error } = await createClient()
    .from('ssbj_narratives')
    .select(SELECT_COLUMNS)
    .eq('reportId', reportId)
    .order('itemId');
  if (error) throw new Error('四本柱の文章の取得に失敗しました');
  return ((data ?? []) as SsbjNarrativeRow[]).map(toSsbjNarrative);
};

/**
 * 1 項目の文章を保存する。行があれば更新し、無ければ作る。
 * upsert（insert … on conflict do update）にしないのは、PostgREST が衝突時の更新に reportId / organizationId / itemId も
 * 含めるため。3 列は作成後に変えない前提で update の列 GRANT に入れていない。
 */
export const saveSsbjNarrative = async (
  report: { id: string; organizationId: string },
  itemId: SsbjItemId,
  text: SsbjDisclosableText,
): Promise<SsbjNarrative> => {
  const supabase = createClient();
  const columns = toColumns(text);

  const updated = await supabase
    .from('ssbj_narratives')
    .update(columns)
    .eq('reportId', report.id)
    .eq('itemId', itemId)
    .select(SELECT_COLUMNS);
  if (updated.error) throw new Error(ssbjWriteErrorMessage(updated.error, '四本柱の文章の保存に失敗しました'));
  const updatedRows = (updated.data ?? []) as SsbjNarrativeRow[];
  if (updatedRows.length > 0) return toSsbjNarrative(updatedRows[0]);

  const inserted = await supabase
    .from('ssbj_narratives')
    .insert({ ...columns, reportId: report.id, organizationId: report.organizationId, itemId })
    .select(SELECT_COLUMNS)
    .single();
  if (inserted.error || !inserted.data) {
    // 23505: 別の画面・別の人が同時に同じ項目の最初の文章を作った。
    if (inserted.error?.code === '23505') {
      throw new Error('他の画面で先に保存されました。画面を開き直してから保存し直してください');
    }
    throw new Error(ssbjWriteErrorMessage(inserted.error, '四本柱の文章の保存に失敗しました'));
  }
  return toSsbjNarrative(inserted.data as SsbjNarrativeRow);
};
