// 保存版の文章セクション（sections.narratives。T05）を社内確認用 CSV の行へ変換する。
// 列は versionCsv.ts の見出し（章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記）にそろえる。
// 要求項目マスターの全項目をマスターの順に出し、文章の無い項目は「未入力」の行にする（出力漏れと未入力を区別するため）。

import { SSBJ_FIELD_STATES, SSBJ_SECTION_IDS, SSBJ_SECTION_LABELS, type SsbjNarrative } from '../types';
import { formatFieldValue } from '../utils/fieldValue';
import { isSsbjItemId } from '../utils/ids';
import { ssbjNarrativeEntriesOfSection } from '../utils/narrative';
import { ssbjRequirementsOfItem } from '../utils/requirementMaster';

const isValidNarrative = (narrative: SsbjNarrative): boolean =>
  !!narrative && isSsbjItemId(narrative.itemId) && !!narrative.text?.disclosure &&
  (SSBJ_FIELD_STATES as readonly string[]).includes(narrative.text.disclosure.state) &&
  (narrative.text.disclosure.state !== 'answered' || narrative.text.disclosure.value?.trim() !== '');

export const narrativeCsvRows = (narratives: SsbjNarrative[]): string[][] => {
  if (!Array.isArray(narratives) || !narratives.every(isValidNarrative)) {
    throw new Error('四本柱の文章の保存内容が不正です');
  }
  return SSBJ_SECTION_IDS.flatMap(sectionId =>
    ssbjNarrativeEntriesOfSection(sectionId, narratives).map(entry => {
      const requirementIds = ssbjRequirementsOfItem(entry.itemId).map(requirement => requirement.id);
      return [
        SSBJ_SECTION_LABELS[sectionId],
        entry.itemId,
        entry.item?.label ?? entry.itemId,
        formatFieldValue(entry.text.disclosure, () => '入力済み'),
        formatFieldValue(entry.text.disclosure),
        '',
        entry.text.internalNote ?? '',
        entry.item
          ? requirementIds.length > 0 ? `要求: ${requirementIds.join('、')}` : '企業固有の補足'
          : '要求項目マスターに無い項目',
      ];
    }),
  );
};
