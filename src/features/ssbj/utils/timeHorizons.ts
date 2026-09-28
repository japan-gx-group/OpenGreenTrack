// レポートとしての時間軸の定義（T07。気候関連開示基準 第19項(4)(5)）の入力の正規化・検証（純関数）。
// 各欄は開示する文章で、状態（未入力・未確認・非該当・入力済み）と本文の対で持つ（docs/ssbj-spec.md §4）。

import type { SsbjFieldState, SsbjFieldValue, SsbjTimeHorizonDefinitions } from '../types';

export const SSBJ_TIME_HORIZON_TEXT_MAX_LENGTH = 2000;

export const SSBJ_TIME_HORIZON_DEFINITION_FIELDS = [
  'shortTerm',
  'mediumTerm',
  'longTerm',
  'planningHorizonRelation',
] as const;

export type SsbjTimeHorizonDefinitionField = (typeof SSBJ_TIME_HORIZON_DEFINITION_FIELDS)[number];

export const SSBJ_TIME_HORIZON_DEFINITION_LABELS: Record<SsbjTimeHorizonDefinitionField, string> = {
  shortTerm: '「短期」の定義',
  mediumTerm: '「中期」の定義',
  longTerm: '「長期」の定義',
  planningHorizonRelation: '定義と戦略上の計画期間との関係',
};

/** 1 つの文章欄の入力値（本文は「入力済み」のときだけ保存する）。 */
export type SsbjTextFieldForm = { state: SsbjFieldState; text: string };

export type SsbjTimeHorizonFormValues = Record<SsbjTimeHorizonDefinitionField, SsbjTextFieldForm> & {
  internalNote: string;
};

/** 定義の行がまだ無いレポートの値（すべて未入力）。 */
export const EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS: SsbjTimeHorizonDefinitions = {
  shortTerm: { state: 'unanswered' },
  mediumTerm: { state: 'unanswered' },
  longTerm: { state: 'unanswered' },
  planningHorizonRelation: { state: 'unanswered' },
  internalNote: null,
};

const toTextValue = (field: SsbjTextFieldForm): SsbjFieldValue<string> =>
  field.state === 'answered' ? { state: 'answered', value: field.text.trim() } : { state: field.state };

const toTextForm = (value: SsbjFieldValue<string>): SsbjTextFieldForm => ({
  state: value.state,
  text: value.state === 'answered' ? value.value : '',
});

/** 入力値を保存用に整える。入力済み以外の欄は本文を捨て、空の内部メモは null にする。 */
export const normalizeSsbjTimeHorizonInput = (values: SsbjTimeHorizonFormValues): SsbjTimeHorizonDefinitions => {
  const internalNote = values.internalNote.trim();
  return {
    shortTerm: toTextValue(values.shortTerm),
    mediumTerm: toTextValue(values.mediumTerm),
    longTerm: toTextValue(values.longTerm),
    planningHorizonRelation: toTextValue(values.planningHorizonRelation),
    internalNote: internalNote === '' ? null : internalNote,
  };
};

/** 正規化済みの入力を検証する。問題が無ければ空配列。 */
export const validateSsbjTimeHorizonInput = (input: SsbjTimeHorizonDefinitions): string[] => {
  const errors: string[] = [];
  for (const field of SSBJ_TIME_HORIZON_DEFINITION_FIELDS) {
    const value = input[field];
    const label = SSBJ_TIME_HORIZON_DEFINITION_LABELS[field];
    if (value.state !== 'answered') continue;
    if (value.value === '') {
      errors.push(`${label}を入力してください（まだ書かない場合は状態を「未入力」などにしてください）`);
    } else if (value.value.length > SSBJ_TIME_HORIZON_TEXT_MAX_LENGTH) {
      errors.push(`${label}は${SSBJ_TIME_HORIZON_TEXT_MAX_LENGTH}文字以内で入力してください`);
    }
  }
  if ((input.internalNote?.length ?? 0) > SSBJ_TIME_HORIZON_TEXT_MAX_LENGTH) {
    errors.push(`内部メモは${SSBJ_TIME_HORIZON_TEXT_MAX_LENGTH}文字以内で入力してください`);
  }
  return errors;
};

/** 保存済みの定義をフォームの入力値へ戻す（編集開始時に使う）。 */
export const toSsbjTimeHorizonFormValues = (definitions: SsbjTimeHorizonDefinitions): SsbjTimeHorizonFormValues => ({
  shortTerm: toTextForm(definitions.shortTerm),
  mediumTerm: toTextForm(definitions.mediumTerm),
  longTerm: toTextForm(definitions.longTerm),
  planningHorizonRelation: toTextForm(definitions.planningHorizonRelation),
  internalNote: definitions.internalNote ?? '',
});
