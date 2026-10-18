// リスク・機会（T07）の入力検証・正規化と、章 / 項目への関連先の扱い（純関数）。
// 入力フォームと保存処理で同じ上限・同じ文言・同じ並び順を使うためにここへ集約する。
// 上限は ssbj_risks_opportunities の列（title varchar(200)）に合わせる。text 列の説明・内部メモは
// DB に上限が無いが、画面で扱える長さに抑えるため上限を設ける。

import {
  SSBJ_RISK_TYPES,
  SSBJ_SECTION_IDS,
  SSBJ_SECTION_LABELS,
  SSBJ_TIME_HORIZONS,
  type SsbjFieldState,
  type SsbjLinkTarget,
  type SsbjRiskOpportunity,
  type SsbjRiskOpportunityKind,
  type SsbjRiskType,
  type SsbjSectionId,
  type SsbjTimeHorizon,
} from '../types';
import { isSsbjItemId, isSsbjSectionId } from './ids';
import { findSsbjNarrativeItem } from './requirementMaster';

export const SSBJ_RISK_TITLE_MAX_LENGTH = 200;
export const SSBJ_RISK_TEXT_MAX_LENGTH = 4000;

/** 時間軸の選択肢。区分を選べば回答済み、それ以外は値を持たない状態。 */
export type SsbjTimeHorizonChoice = SsbjTimeHorizon | Exclude<SsbjFieldState, 'answered'>;

/**
 * リスクの種類の選択肢。種類を選べば回答済み。リスクは必ず物理的か移行のどちらかなので「非該当」は選ばせない
 * （機会は保存時に自動で非該当にする）。
 */
export type SsbjRiskTypeChoice = SsbjRiskType | 'unanswered' | 'unconfirmed';

/** フォームの入力値（未入力の文字列は空文字）。 */
export type SsbjRiskOpportunityFormValues = {
  kind: SsbjRiskOpportunityKind;
  title: string;
  riskType: SsbjRiskTypeChoice;
  descriptionState: SsbjFieldState;
  descriptionText: string;
  internalNote: string;
  timeHorizon: SsbjTimeHorizonChoice;
  linkTargets: SsbjLinkTarget[];
};

/** 保存する内容（ID は DB が決める）。 */
export type SsbjRiskOpportunityInput = Omit<SsbjRiskOpportunity, 'id'>;

export const EMPTY_SSBJ_RISK_OPPORTUNITY_FORM_VALUES: SsbjRiskOpportunityFormValues = {
  kind: 'risk',
  title: '',
  riskType: 'unanswered',
  descriptionState: 'unanswered',
  descriptionText: '',
  internalNote: '',
  timeHorizon: 'unanswered',
  linkTargets: [],
};

const isTimeHorizon = (value: string): value is SsbjTimeHorizon =>
  (SSBJ_TIME_HORIZONS as readonly string[]).includes(value);

const isRiskType = (value: string): value is SsbjRiskType =>
  (SSBJ_RISK_TYPES as readonly string[]).includes(value);

/** 関連先の章（章 ID ならそれ自身、項目 ID なら接頭辞）。 */
export const sectionOfLinkTarget = (target: SsbjLinkTarget): SsbjSectionId =>
  target.slice(0, target.includes('.') ? target.indexOf('.') : undefined) as SsbjSectionId;

/**
 * 関連先を重複なく、章の順（ガバナンス → 戦略 → リスク管理 → 指標及び目標）に並べる。
 * 同じ章では章そのものを先に、項目は ID 順にする（表示・保存版・CSV で順序を揃えるため）。
 */
export const sortLinkTargets = (targets: SsbjLinkTarget[]): SsbjLinkTarget[] =>
  [...new Set(targets)].sort((a, b) => {
    const bySection =
      SSBJ_SECTION_IDS.indexOf(sectionOfLinkTarget(a)) - SSBJ_SECTION_IDS.indexOf(sectionOfLinkTarget(b));
    if (bySection !== 0) return bySection;
    if (isSsbjSectionId(a) !== isSsbjSectionId(b)) return isSsbjSectionId(a) ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

/**
 * 関連先の表示。章なら章名（例「戦略」）、項目なら章名と項目 ID（例「戦略：strategy.climate_resilience」）。
 * 項目の名称は要求項目マスター・文章画面ができるまで無いため、ID をそのまま出す。
 */
export const formatLinkTarget = (target: SsbjLinkTarget): string => {
  const sectionLabel = SSBJ_SECTION_LABELS[sectionOfLinkTarget(target)];
  return isSsbjSectionId(target) ? sectionLabel : `${sectionLabel}：${target}`;
};

/**
 * 関連先の表示（入力画面用）。項目が要求項目マスターにあれば項目名を出す（例「戦略：ビジネス・モデルとバリュー・チェーンへの影響」）。
 * マスターに無い項目（以前に識別子を手で入れたもの）は、ID のままと分かるように出す。
 */
export const formatLinkTargetWithLabel = (target: SsbjLinkTarget): string => {
  const sectionLabel = SSBJ_SECTION_LABELS[sectionOfLinkTarget(target)];
  if (isSsbjSectionId(target)) return sectionLabel;
  const item = findSsbjNarrativeItem(target);
  return item ? `${sectionLabel}：${item.label}` : `${sectionLabel}：${target}（要求項目マスターに無い項目）`;
};

/** 関連先が章か、要求項目マスターにある項目か（マスターに無い任意の識別子は正式な項目として扱わない）。 */
export const isKnownLinkTarget = (target: SsbjLinkTarget): boolean =>
  isSsbjSectionId(target) || (isSsbjItemId(target) && findSsbjNarrativeItem(target) !== undefined);

/**
 * 入力値を保存用に整える。説明は「入力済み」のときだけ本文を持ち、それ以外の状態では本文を捨てる
 * （未確認の下書きは内部メモに書く。docs/ssbj-spec.md §4）。未入力の内部メモは null にする。
 * 機会にはリスクの種類が無いため、フォームの選択に関係なく非該当にする。
 */
export const normalizeSsbjRiskOpportunityInput = (
  values: SsbjRiskOpportunityFormValues,
): SsbjRiskOpportunityInput => {
  const internalNote = values.internalNote.trim();
  return {
    kind: values.kind,
    title: values.title.trim(),
    riskType:
      values.kind === 'opportunity'
        ? { state: 'not_applicable' }
        : isRiskType(values.riskType)
          ? { state: 'answered', value: values.riskType }
          : { state: values.riskType },
    description: {
      disclosure:
        values.descriptionState === 'answered'
          ? { state: 'answered', value: values.descriptionText.trim() }
          : { state: values.descriptionState },
      internalNote: internalNote === '' ? null : internalNote,
    },
    timeHorizon: isTimeHorizon(values.timeHorizon)
      ? { state: 'answered', value: values.timeHorizon }
      : { state: values.timeHorizon },
    linkTargets: sortLinkTargets(values.linkTargets),
  };
};

/**
 * 正規化済みの入力を検証する。問題が無ければ空配列。複数の問題は全件返す。
 * 関連する項目は要求項目マスターにあるものだけを受け付ける。ただし savedLinkTargets（編集前から保存されていた関連先）は、
 * マスターに無くても残せる（以前に識別子を手で入れたデータを、編集しただけで失わないため。画面ではマスターに無いと出す）。
 */
export const validateSsbjRiskOpportunityInput = (
  input: SsbjRiskOpportunityInput,
  savedLinkTargets: readonly SsbjLinkTarget[] = [],
): string[] => {
  const errors: string[] = [];
  if (!input.title) errors.push('名称を入力してください');
  if (input.title.length > SSBJ_RISK_TITLE_MAX_LENGTH) {
    errors.push(`名称は${SSBJ_RISK_TITLE_MAX_LENGTH}文字以内で入力してください`);
  }
  const disclosure = input.description.disclosure;
  if (disclosure.state === 'answered' && disclosure.value === '') {
    errors.push('説明を入力してください（まだ書かない場合は状態を「未入力」などにしてください）');
  }
  if (disclosure.state === 'answered' && disclosure.value.length > SSBJ_RISK_TEXT_MAX_LENGTH) {
    errors.push(`説明は${SSBJ_RISK_TEXT_MAX_LENGTH}文字以内で入力してください`);
  }
  if ((input.description.internalNote?.length ?? 0) > SSBJ_RISK_TEXT_MAX_LENGTH) {
    errors.push(`内部メモは${SSBJ_RISK_TEXT_MAX_LENGTH}文字以内で入力してください`);
  }
  if (input.linkTargets.some(target => !isSsbjSectionId(target) && !isSsbjItemId(target))) {
    errors.push('関連する章・項目の形式が正しくありません');
  }
  const unknownTargets = input.linkTargets.filter(
    target => isSsbjItemId(target) && !isKnownLinkTarget(target) && !savedLinkTargets.includes(target),
  );
  if (unknownTargets.length > 0) {
    errors.push(`要求項目マスターに無い項目は関連付けられません（${unknownTargets.join('、')}）。一覧から項目を選んでください`);
  }
  return errors;
};

/** 保存済みのリスク・機会をフォームの入力値へ戻す（編集開始時に使う）。 */
export const toSsbjRiskOpportunityFormValues = (
  item: SsbjRiskOpportunityInput,
): SsbjRiskOpportunityFormValues => {
  const disclosure = item.description.disclosure;
  return {
    kind: item.kind,
    title: item.title,
    // 機会の「非該当」はフォームの選択肢に無いため、未入力として戻す（機会の間は保存時に非該当へ戻る）。
    riskType:
      item.riskType.state === 'answered'
        ? item.riskType.value
        : item.riskType.state === 'not_applicable'
          ? 'unanswered'
          : item.riskType.state,
    descriptionState: disclosure.state,
    descriptionText: disclosure.state === 'answered' ? disclosure.value : '',
    internalNote: item.description.internalNote ?? '',
    timeHorizon: item.timeHorizon.state === 'answered' ? item.timeHorizon.value : item.timeHorizon.state,
    linkTargets: item.linkTargets,
  };
};
