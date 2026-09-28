// リスク・機会（T07）の入力検証・正規化と、章 / 項目への関連先の扱い（純関数）。
// 入力フォームと保存処理で同じ上限・同じ文言・同じ並び順を使うためにここへ集約する。
// 上限は ssbj_risks_opportunities の列（title varchar(200)）に合わせる。text 列の説明・内部メモは
// DB に上限が無いが、画面で扱える長さに抑えるため上限を設ける。

import {
  SSBJ_SECTION_IDS,
  SSBJ_SECTION_LABELS,
  SSBJ_TIME_HORIZONS,
  type SsbjFieldState,
  type SsbjLinkTarget,
  type SsbjRiskOpportunity,
  type SsbjRiskOpportunityKind,
  type SsbjSectionId,
  type SsbjTimeHorizon,
} from '../types';
import { isSsbjItemId, isSsbjSectionId } from './ids';

export const SSBJ_RISK_TITLE_MAX_LENGTH = 200;
export const SSBJ_RISK_TEXT_MAX_LENGTH = 4000;

/** 時間軸の選択肢。区分を選べば回答済み、それ以外は値を持たない状態。 */
export type SsbjTimeHorizonChoice = SsbjTimeHorizon | Exclude<SsbjFieldState, 'answered'>;

/** フォームの入力値（未入力の文字列は空文字）。 */
export type SsbjRiskOpportunityFormValues = {
  kind: SsbjRiskOpportunityKind;
  title: string;
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
  descriptionState: 'unanswered',
  descriptionText: '',
  internalNote: '',
  timeHorizon: 'unanswered',
  linkTargets: [],
};

const isTimeHorizon = (value: string): value is SsbjTimeHorizon =>
  (SSBJ_TIME_HORIZONS as readonly string[]).includes(value);

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
 * 章と項目の識別子（任意）から関連先を作る。識別子が空なら章そのもの。
 * 形式が正しくなければ null（項目 ID は `<章ID>.<英小文字・数字・_>`。docs/ssbj-spec.md §3）。
 */
export const toLinkTarget = (section: SsbjSectionId, itemSlug: string): SsbjLinkTarget | null => {
  const slug = itemSlug.trim();
  if (slug === '') return section;
  const itemId = `${section}.${slug}`;
  return isSsbjItemId(itemId) ? itemId : null;
};

/**
 * 入力値を保存用に整える。説明は「入力済み」のときだけ本文を持ち、それ以外の状態では本文を捨てる
 * （未確認の下書きは内部メモに書く。docs/ssbj-spec.md §4）。未入力の内部メモは null にする。
 */
export const normalizeSsbjRiskOpportunityInput = (
  values: SsbjRiskOpportunityFormValues,
): SsbjRiskOpportunityInput => {
  const internalNote = values.internalNote.trim();
  return {
    kind: values.kind,
    title: values.title.trim(),
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

/** 正規化済みの入力を検証する。問題が無ければ空配列。複数の問題は全件返す。 */
export const validateSsbjRiskOpportunityInput = (input: SsbjRiskOpportunityInput): string[] => {
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
    descriptionState: disclosure.state,
    descriptionText: disclosure.state === 'answered' ? disclosure.value : '',
    internalNote: item.description.internalNote ?? '',
    timeHorizon: item.timeHorizon.state === 'answered' ? item.timeHorizon.value : item.timeHorizon.state,
    linkTargets: item.linkTargets,
  };
};
