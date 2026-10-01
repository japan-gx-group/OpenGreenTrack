// 保存版の判断セクション（sections.judgements。T09）を社内確認用 CSV の行へ変換する。
// 列は versionCsv.ts の見出し（章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記）にそろえる。
// 要求項目マスターの全要求をマスターの順に出し、判断の無い要求は「未確認」の行にする（出力漏れと未判断を区別するため）。
// 1 要求につき 該当性・重要性・記載しない理由・開示する説明 の 4 行を出す（リスク・機会と同じく、属性ごとに 1 行）。

import {
  SSBJ_APPLICABILITIES,
  SSBJ_FIELD_STATES,
  SSBJ_MATERIALITIES,
  SSBJ_OMISSION_REASONS,
  SSBJ_SECTION_LABELS,
  type SsbjJudgement,
} from '../types';
import { formatFieldValue } from '../utils/fieldValue';
import { isSsbjRequirementId } from '../utils/ids';
import {
  SSBJ_APPLICABILITY_LABELS,
  SSBJ_MATERIALITY_LABELS,
  SSBJ_OMISSION_REASON_LABELS,
  ssbjJudgementEntries,
} from '../utils/judgement';
import { formatParagraphReference } from '../utils/requirementMaster';

const GROUP = '該当性・重要性の判断';

const includes = (values: readonly string[], value: unknown): boolean =>
  typeof value === 'string' && values.includes(value);

const isValidJudgement = (judgement: SsbjJudgement): boolean =>
  !!judgement && isSsbjRequirementId(judgement.requirementId) &&
  includes(SSBJ_APPLICABILITIES, judgement.applicability) &&
  includes(SSBJ_MATERIALITIES, judgement.materiality) &&
  includes(SSBJ_OMISSION_REASONS, judgement.omissionReason) &&
  !!judgement.explanation?.disclosure && includes(SSBJ_FIELD_STATES, judgement.explanation.disclosure.state) &&
  (judgement.explanation.disclosure.state !== 'answered' || judgement.explanation.disclosure.value?.trim() !== '');

export const judgementCsvRows = (judgements: SsbjJudgement[]): string[][] => {
  if (!Array.isArray(judgements) || !judgements.every(isValidJudgement)) {
    throw new Error('該当性・重要性の判断の保存内容が不正です');
  }
  return ssbjJudgementEntries(judgements).flatMap(({ requirement, judgement }) => {
    const note = requirement
      ? `${requirement.sectionId ? SSBJ_SECTION_LABELS[requirement.sectionId] : '全般'}／` +
        `${requirement.references.map(formatParagraphReference).join('・')}／${requirement.summary}`
      : '要求項目マスターに無い要求';
    const id = judgement.requirementId;
    const { disclosure, internalNote } = judgement.explanation;
    const decided = (isUnconfirmed: boolean) => (isUnconfirmed ? '未確認' : '入力済み');
    return [
      [GROUP, id, '該当性', decided(judgement.applicability === 'unconfirmed'),
        SSBJ_APPLICABILITY_LABELS[judgement.applicability], '', '', note],
      [GROUP, id, '重要性', decided(judgement.materiality === 'unconfirmed'),
        SSBJ_MATERIALITY_LABELS[judgement.materiality], '', '', note],
      [GROUP, id, '記載しない理由', '入力済み', SSBJ_OMISSION_REASON_LABELS[judgement.omissionReason], '', '', note],
      [GROUP, id, '開示する説明', formatFieldValue(disclosure, () => '入力済み'), formatFieldValue(disclosure),
        '', internalNote ?? '', note],
    ];
  });
};
