// 該当性・重要性・記載しない理由（T09）の純関数: 表示名、入力の正規化・検証、要求項目マスターの要求への当てはめ。
// 画面・プレビュー・CSV が同じ並び（マスターの順）と同じ「行が無い要求は未確認」の扱いで判断を出すため、ここに一本化する。
// ソフトは判断を自動で決めない。既定はすべて「未確認」で、利用者が選んだ値だけを保存する。

import type {
  SsbjApplicability,
  SsbjFieldState,
  SsbjJudgement,
  SsbjMateriality,
  SsbjOmissionReason,
  SsbjRequirement,
  SsbjRequirementId,
} from '../types';
import { SSBJ_REQUIREMENTS, findSsbjRequirement } from './requirementMaster';

export const SSBJ_JUDGEMENT_TEXT_MAX_LENGTH = 2000;

export const SSBJ_APPLICABILITY_LABELS: Record<SsbjApplicability, string> = {
  unconfirmed: '未確認',
  applicable: '該当',
  not_applicable: '非該当',
};

export const SSBJ_MATERIALITY_LABELS: Record<SsbjMateriality, string> = {
  unconfirmed: '未確認',
  material: '重要性あり',
  not_material: '重要性なし',
};

export const SSBJ_OMISSION_REASON_LABELS: Record<SsbjOmissionReason, string> = {
  none: '記載する',
  not_material: '重要性がない',
  transition_relief: '経過措置を適用',
  commercial_sensitivity: '機会の情報が商業上の機密',
  other: 'その他',
};

/** 記載しない理由の根拠となる項番号（docs/ssbj-r1-scope.md §4 の版で確認したもの）。 */
export const SSBJ_OMISSION_REASON_REFERENCES: Partial<Record<SsbjOmissionReason, string>> = {
  not_material: '適用基準 第22項',
  transition_relief: '適用基準 第93項・第94項、気候基準 第102項・第103項',
  commercial_sensitivity: '適用基準 第13項〜第16項',
};

/** その理由で記載しないこと自体の開示が基準で求められる理由（適用基準 第14項・第93項・第94項、気候基準 第102項・第103項）。 */
const OMISSION_REASONS_REQUIRING_STATEMENT: readonly SsbjOmissionReason[] = ['transition_relief', 'commercial_sensitivity'];

/** 記載しない旨の開示が求められるのに、開示する説明がまだ入力済みでないか（保存は止めず、画面で知らせる）。 */
export const isSsbjOmissionStatementMissing = (judgement: SsbjJudgement): boolean =>
  OMISSION_REASONS_REQUIRING_STATEMENT.includes(judgement.omissionReason) &&
  judgement.explanation.disclosure.state !== 'answered';

/** 行がまだ無い要求の判断（すべて未確認・記載する・説明は未入力）。 */
export const emptySsbjJudgement = (requirementId: SsbjRequirementId): SsbjJudgement => ({
  requirementId,
  applicability: 'unconfirmed',
  materiality: 'unconfirmed',
  omissionReason: 'none',
  explanation: { disclosure: { state: 'unanswered' }, internalNote: null },
});

/** 判断が 1 つでも記録されているか（すべて既定のままなら未判断）。 */
export const isSsbjJudgementRecorded = (judgement: SsbjJudgement): boolean =>
  judgement.applicability !== 'unconfirmed' || judgement.materiality !== 'unconfirmed' ||
  judgement.omissionReason !== 'none' || judgement.explanation.disclosure.state !== 'unanswered' ||
  judgement.explanation.internalNote !== null;

/**
 * 判断が済んでいないか（「未確認のみ」の絞り込みと件数に使う）。該当性が未確認、または該当なのに重要性が未確認のとき。
 * 非該当の要求は重要性を判断しなくてよい。
 */
export const isSsbjJudgementPending = (judgement: SsbjJudgement): boolean =>
  judgement.applicability === 'unconfirmed' ||
  (judgement.applicability === 'applicable' && judgement.materiality === 'unconfirmed');

/** 編集フォームの値。説明の本文は「入力済み」のときだけ保存する。 */
export type SsbjJudgementFormValues = {
  applicability: SsbjApplicability;
  materiality: SsbjMateriality;
  omissionReason: SsbjOmissionReason;
  explanationState: SsbjFieldState;
  explanationText: string;
  internalReason: string;
};

export const toSsbjJudgementFormValues = (judgement: SsbjJudgement): SsbjJudgementFormValues => ({
  applicability: judgement.applicability,
  materiality: judgement.materiality,
  omissionReason: judgement.omissionReason,
  explanationState: judgement.explanation.disclosure.state,
  explanationText: judgement.explanation.disclosure.state === 'answered' ? judgement.explanation.disclosure.value : '',
  internalReason: judgement.explanation.internalNote ?? '',
});

/** 入力値を保存用に整える。入力済み以外は説明の本文を捨て、空の内部理由は null にする。 */
export const normalizeSsbjJudgementInput = (
  requirementId: SsbjRequirementId,
  values: SsbjJudgementFormValues,
): SsbjJudgement => {
  const internalReason = values.internalReason.trim();
  return {
    requirementId,
    applicability: values.applicability,
    materiality: values.materiality,
    omissionReason: values.omissionReason,
    explanation: {
      disclosure: values.explanationState === 'answered'
        ? { state: 'answered', value: values.explanationText.trim() }
        : { state: values.explanationState },
      internalNote: internalReason === '' ? null : internalReason,
    },
  };
};

/** 正規化済みの判断を検証する。問題が無ければ空配列。 */
export const validateSsbjJudgementInput = (judgement: SsbjJudgement): string[] => {
  const errors: string[] = [];
  if (!findSsbjRequirement(judgement.requirementId)) {
    errors.push('要求項目マスターに無い要求です');
  }
  if (judgement.omissionReason === 'not_material' && judgement.materiality !== 'not_material') {
    errors.push('「重要性がない」を理由にするときは、重要性を「重要性なし」にしてください');
  }
  if ((judgement.omissionReason === 'other' || judgement.omissionReason === 'commercial_sensitivity') &&
    judgement.explanation.internalNote === null) {
    errors.push('この理由で記載しないときは、内部の検討理由を書いてください');
  }
  const { disclosure, internalNote } = judgement.explanation;
  if (disclosure.state === 'answered') {
    if (disclosure.value === '') {
      errors.push('開示する説明を入力してください（まだ書かない場合は状態を「未入力」などにしてください）');
    } else if (disclosure.value.length > SSBJ_JUDGEMENT_TEXT_MAX_LENGTH) {
      errors.push(`開示する説明は${SSBJ_JUDGEMENT_TEXT_MAX_LENGTH}文字以内で入力してください`);
    }
  }
  if ((internalNote?.length ?? 0) > SSBJ_JUDGEMENT_TEXT_MAX_LENGTH) {
    errors.push(`内部の検討理由は${SSBJ_JUDGEMENT_TEXT_MAX_LENGTH}文字以内で入力してください`);
  }
  return errors;
};

/** 表示・出力する 1 件。マスターに無い要求（ID の見直しで消えた要求など）は requirement が null。 */
export type SsbjJudgementEntry = { requirement: SsbjRequirement | null; judgement: SsbjJudgement };

/**
 * マスターの全要求を順に並べ、判断の無い要求は未確認として出す。マスターに無い要求の判断は最後に足す（黙って落とさない）。
 */
export const ssbjJudgementEntries = (judgements: readonly SsbjJudgement[]): SsbjJudgementEntry[] => {
  const byRequirement = new Map(judgements.map(judgement => [judgement.requirementId, judgement]));
  const entries: SsbjJudgementEntry[] = SSBJ_REQUIREMENTS.map(requirement => ({
    requirement,
    judgement: byRequirement.get(requirement.id) ?? emptySsbjJudgement(requirement.id),
  }));
  for (const judgement of judgements) {
    if (!findSsbjRequirement(judgement.requirementId)) entries.push({ requirement: null, judgement });
  }
  return entries;
};
