// 章 ID・項目 ID・要求 ID の形式検証（docs/ssbj-spec.md §3）。
// DB の check 制約・要求項目マスター・画面入力で同じ形式を使うため、正規表現はここを正本にする。

import {
  SSBJ_SECTION_IDS,
  SSBJ_STANDARD_CODES,
  type SsbjItemId,
  type SsbjRequirementId,
  type SsbjSectionId,
  type SsbjStandardCode,
} from '../types';

/** 項目 ID: `<章ID>.<slug>`。slug は英小文字・数字・アンダースコア。 */
export const SSBJ_ITEM_ID_PATTERN = new RegExp(`^(${SSBJ_SECTION_IDS.join('|')})\\.[a-z0-9_]+$`);

/** 要求 ID: `REQ-<基準コード>-<3桁連番>`。 */
export const SSBJ_REQUIREMENT_ID_PATTERN = new RegExp(
  `^REQ-(${SSBJ_STANDARD_CODES.join('|')})-\\d{3}$`,
);

export const isSsbjSectionId = (value: unknown): value is SsbjSectionId =>
  typeof value === 'string' && (SSBJ_SECTION_IDS as readonly string[]).includes(value);

export const isSsbjItemId = (value: unknown): value is SsbjItemId =>
  typeof value === 'string' && SSBJ_ITEM_ID_PATTERN.test(value);

export const isSsbjRequirementId = (value: unknown): value is SsbjRequirementId =>
  typeof value === 'string' && SSBJ_REQUIREMENT_ID_PATTERN.test(value);

/** 項目 ID が属する章。項目 ID の接頭辞から決まる（別の列で章を持たせて食い違わせない）。 */
export const sectionOfItem = (itemId: SsbjItemId): SsbjSectionId => {
  const section = itemId.slice(0, itemId.indexOf('.'));
  if (!isSsbjSectionId(section)) {
    throw new Error(`項目IDの形式が正しくありません: ${itemId}`);
  }
  return section;
};

/** 要求 ID の基準コード。 */
export const standardOfRequirement = (requirementId: SsbjRequirementId): SsbjStandardCode => {
  if (!isSsbjRequirementId(requirementId)) {
    throw new Error(`要求IDの形式が正しくありません: ${requirementId}`);
  }
  return requirementId.slice(4, 7) as SsbjStandardCode;
};
