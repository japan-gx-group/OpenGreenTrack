// 章 ID・項目 ID・要求 ID・指標 ID の形式検証（docs/tnfd-spec.md §3）。
// DB の check 制約・要求項目マスター・指標マスター・画面入力で同じ形式を使うため、正規表現はここを正本にする。

import {
  TNFD_SECTION_IDS,
  TNFD_STANDARD_CODES,
  type TnfdItemId,
  type TnfdMetricId,
  type TnfdRequirementId,
  type TnfdSectionId,
  type TnfdStandardCode,
} from '../types';

/** 項目 ID: `<章ID>.<slug>`。slug は英小文字・数字・アンダースコア。 */
export const TNFD_ITEM_ID_PATTERN = new RegExp(`^(${TNFD_SECTION_IDS.join('|')})\\.[a-z0-9_]+$`);

/** 要求 ID: `REQ-<基準コード>-<3桁連番>`。 */
export const TNFD_REQUIREMENT_ID_PATTERN = new RegExp(
  `^REQ-(${TNFD_STANDARD_CODES.join('|')})-\\d{3}$`,
);

/** 指標 ID: 英小文字始まりの slug。 */
export const TNFD_METRIC_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export const isTnfdSectionId = (value: unknown): value is TnfdSectionId =>
  typeof value === 'string' && (TNFD_SECTION_IDS as readonly string[]).includes(value);

export const isTnfdItemId = (value: unknown): value is TnfdItemId =>
  typeof value === 'string' && TNFD_ITEM_ID_PATTERN.test(value);

export const isTnfdRequirementId = (value: unknown): value is TnfdRequirementId =>
  typeof value === 'string' && TNFD_REQUIREMENT_ID_PATTERN.test(value);

export const isTnfdMetricId = (value: unknown): value is TnfdMetricId =>
  typeof value === 'string' && TNFD_METRIC_ID_PATTERN.test(value);

/** 項目 ID が属する章。項目 ID の接頭辞から決まる（別の列で章を持たせて食い違わせない）。 */
export const sectionOfItem = (itemId: TnfdItemId): TnfdSectionId => {
  const section = itemId.slice(0, itemId.indexOf('.'));
  if (!isTnfdSectionId(section)) {
    throw new Error(`項目IDの形式が正しくありません: ${itemId}`);
  }
  return section;
};

/** 要求 ID の基準コード。 */
export const standardOfRequirement = (requirementId: TnfdRequirementId): TnfdStandardCode => {
  if (!isTnfdRequirementId(requirementId)) {
    throw new Error(`要求IDの形式が正しくありません: ${requirementId}`);
  }
  const code = requirementId.slice(4, requirementId.lastIndexOf('-'));
  return code as TnfdStandardCode;
};
