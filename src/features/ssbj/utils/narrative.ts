// 四本柱・企業固有の補足の文章（T05）の純関数: 入力の正規化・検証と、要求項目マスターの項目への当てはめ。
// 画面・プレビュー・CSV が同じ並び（マスターの順）と同じ「行が無い項目は未入力」の扱いで文章を出すため、ここに一本化する。

import type {
  SsbjDisclosableText,
  SsbjFieldState,
  SsbjItemId,
  SsbjNarrative,
  SsbjNarrativeItem,
  SsbjSectionId,
} from '../types';
import { isSsbjItemId, sectionOfItem } from './ids';
import { SSBJ_NARRATIVE_ITEMS, findSsbjNarrativeItem } from './requirementMaster';

export const SSBJ_NARRATIVE_TEXT_MAX_LENGTH = 5000;

/** 1 項目の編集フォームの値。本文は「入力済み」のときだけ保存する。 */
export type SsbjNarrativeFormValues = { state: SsbjFieldState; text: string; internalNote: string };

/** 行がまだ無い項目の文章（未入力）。 */
export const EMPTY_SSBJ_DISCLOSABLE_TEXT: SsbjDisclosableText = { disclosure: { state: 'unanswered' }, internalNote: null };

export const toSsbjNarrativeFormValues = (text: SsbjDisclosableText): SsbjNarrativeFormValues => ({
  state: text.disclosure.state,
  text: text.disclosure.state === 'answered' ? text.disclosure.value : '',
  internalNote: text.internalNote ?? '',
});

/** 入力値を保存用に整える。入力済み以外は本文を捨て、空の内部メモは null にする。 */
export const normalizeSsbjNarrativeInput = (values: SsbjNarrativeFormValues): SsbjDisclosableText => {
  const internalNote = values.internalNote.trim();
  return {
    disclosure: values.state === 'answered' ? { state: 'answered', value: values.text.trim() } : { state: values.state },
    internalNote: internalNote === '' ? null : internalNote,
  };
};

/** 正規化済みの入力と項目 ID を検証する。問題が無ければ空配列。 */
export const validateSsbjNarrativeInput = (itemId: string, input: SsbjDisclosableText): string[] => {
  const errors: string[] = [];
  if (!isSsbjItemId(itemId) || !findSsbjNarrativeItem(itemId)) {
    errors.push('要求項目マスターに無い項目です');
  }
  if (input.disclosure.state === 'answered') {
    if (input.disclosure.value === '') {
      errors.push('開示する文章を入力してください（まだ書かない場合は状態を「未入力」などにしてください）');
    } else if (input.disclosure.value.length > SSBJ_NARRATIVE_TEXT_MAX_LENGTH) {
      errors.push(`開示する文章は${SSBJ_NARRATIVE_TEXT_MAX_LENGTH}文字以内で入力してください`);
    }
  }
  if ((input.internalNote?.length ?? 0) > SSBJ_NARRATIVE_TEXT_MAX_LENGTH) {
    errors.push(`内部メモは${SSBJ_NARRATIVE_TEXT_MAX_LENGTH}文字以内で入力してください`);
  }
  return errors;
};

/** 表示・出力する 1 項目。マスターに無い項目（ID の見直しで消えた項目など）は item が null。 */
export type SsbjNarrativeEntry = { itemId: SsbjItemId; item: SsbjNarrativeItem | null; text: SsbjDisclosableText };

/**
 * 章の文章を、マスターの項目の順に並べる。保存された文章が無い項目は未入力として出し、
 * マスターに無い項目の文章は最後に足す（黙って落とさない）。
 */
export const ssbjNarrativeEntriesOfSection = (
  sectionId: SsbjSectionId,
  narratives: readonly SsbjNarrative[],
): SsbjNarrativeEntry[] => {
  const byItem = new Map(narratives.map(narrative => [narrative.itemId, narrative.text]));
  const entries: SsbjNarrativeEntry[] = SSBJ_NARRATIVE_ITEMS
    .filter(item => sectionOfItem(item.id) === sectionId)
    .map(item => ({ itemId: item.id, item, text: byItem.get(item.id) ?? EMPTY_SSBJ_DISCLOSABLE_TEXT }));
  for (const narrative of narratives) {
    if (sectionOfItem(narrative.itemId) === sectionId && !findSsbjNarrativeItem(narrative.itemId)) {
      entries.push({ itemId: narrative.itemId, item: null, text: narrative.text });
    }
  }
  return entries;
};
