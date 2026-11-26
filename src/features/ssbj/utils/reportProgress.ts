// SSBJ レポートの進み具合（どこまで書けたか）を、作業中の内容（プレビューの元データ。保存版と同じ形）から数える純関数。
// 画面の上のタブ（SsbjReportTabs）・詳細画面の「レポートの内容」（全体の進み具合と次にやること）・レビュー依頼の前の点検表
// （utils/reviewChecklist.ts）が、同じ数え方を使うためにここへ一本化する。数え方の説明は docs/ssbj-spec.md §13「画面のタブと進み具合」にも書く（変えたら両方を直す）。
// DB は変えず、数えるだけ。行の無い文章は未入力、行の無い要求は未判断として数える（プレビュー・CSV と同じ扱い）。

import type { SsbjNarrative, SsbjSnapshotSections } from '../types';
import { ssbjJudgementEntries, ssbjJudgementStatus } from './judgement';
import { ssbjTemplatePlaceholders } from './narrative';
import { SSBJ_NARRATIVE_ITEMS } from './requirementMaster';

/**
 * 文章の進み具合。対象は要求項目マスターの「要求に答える項目」（企業固有の補足は任意なので数えない）。
 * - answered: 入力済み / notApplicable: 非該当 / unconfirmed: 未確認 / unanswered: 未入力（行が無い項目を含む）
 * - done: 状態が決まった項目（入力済み＋非該当）。total: 要求に答える項目の数
 * - placeholders: テンプレートの【 】が、開示する文章か内部メモに残っている項目の数（補足の項目も含む。
 *   【 】が残ったままでは入力済みにできないので、書きかけを内部メモに移して未確認にしたものがここに入る）
 */
export type SsbjNarrativeProgress = {
  total: number;
  done: number;
  answered: number;
  notApplicable: number;
  unconfirmed: number;
  unanswered: number;
  placeholders: number;
};

/**
 * 判断の進み具合。対象は要求項目マスターの全要求（マスターに無い要求の判断は数えない）。
 * 状態は判断の一覧の絞り込みと同じ（utils/judgement.ts の ssbjJudgementStatus）:
 * decided = 判断済み / needsReview = 要確認（記録はあるが、判断・根拠・記載しない旨の説明が足りない）/ undecided = 未判断（何も記録していない）
 */
export type SsbjJudgementProgress = { total: number; decided: number; needsReview: number; undecided: number };

/**
 * 根拠の進み具合。入力済みの文章（補足を含むすべての項目）のうち、根拠文書が 1 件以上ある項目の数。
 * total: 入力済みの文章の項目数 / withEvidence: そのうち根拠文書がある項目数
 */
export type SsbjEvidenceProgress = { total: number; withEvidence: number };

export type SsbjReportProgress = {
  narratives: SsbjNarrativeProgress;
  judgements: SsbjJudgementProgress;
  evidence: SsbjEvidenceProgress;
  /** リスク・機会の件数。 */
  risks: { risk: number; opportunity: number };
  /** OGT の値を GHG の画面で採用しているか。 */
  ghgAdopted: boolean;
  /** 外部で算定した排出量の件数。 */
  externalEmissions: number;
};

const hasPlaceholder = (narrative: SsbjNarrative): boolean => {
  const { disclosure, internalNote } = narrative.text;
  const texts = [disclosure.state === 'answered' ? disclosure.value : '', internalNote ?? ''];
  return texts.some(text => ssbjTemplatePlaceholders(text).length > 0);
};

/** 作業中の内容（保存版と同じ形のセクション）から、進み具合を数える。 */
export const ssbjReportProgress = (sections: Partial<SsbjSnapshotSections>): SsbjReportProgress => {
  const narratives = sections.narratives ?? [];
  const byItem = new Map(narratives.map(narrative => [narrative.itemId, narrative]));

  const narrativeProgress: SsbjNarrativeProgress = {
    total: 0, done: 0, answered: 0, notApplicable: 0, unconfirmed: 0, unanswered: 0,
    placeholders: narratives.filter(hasPlaceholder).length,
  };
  for (const item of SSBJ_NARRATIVE_ITEMS) {
    if (item.kind !== 'requirement') continue;
    narrativeProgress.total += 1;
    const state = byItem.get(item.id)?.text.disclosure.state ?? 'unanswered';
    if (state === 'answered') narrativeProgress.answered += 1;
    else if (state === 'not_applicable') narrativeProgress.notApplicable += 1;
    else if (state === 'unconfirmed') narrativeProgress.unconfirmed += 1;
    else narrativeProgress.unanswered += 1;
  }
  narrativeProgress.done = narrativeProgress.answered + narrativeProgress.notApplicable;

  const judgementProgress: SsbjJudgementProgress = { total: 0, decided: 0, needsReview: 0, undecided: 0 };
  for (const entry of ssbjJudgementEntries(sections.judgements ?? [])) {
    if (!entry.requirement) continue;
    judgementProgress.total += 1;
    const status = ssbjJudgementStatus(entry.judgement);
    if (status === 'decided') judgementProgress.decided += 1;
    else if (status === 'needs_review') judgementProgress.needsReview += 1;
    else judgementProgress.undecided += 1;
  }

  const evidenceItems = new Set((sections.evidence ?? []).map(evidence => evidence.itemId));
  const answeredItems = narratives.filter(narrative => narrative.text.disclosure.state === 'answered');
  const risks = sections.risks_opportunities ?? [];

  return {
    narratives: narrativeProgress,
    judgements: judgementProgress,
    evidence: {
      total: answeredItems.length,
      withEvidence: answeredItems.filter(narrative => evidenceItems.has(narrative.itemId)).length,
    },
    risks: {
      risk: risks.filter(risk => risk.kind === 'risk').length,
      opportunity: risks.filter(risk => risk.kind === 'opportunity').length,
    },
    ghgAdopted: !!sections.ghg,
    externalEmissions: (sections.external_emissions ?? []).length,
  };
};

/**
 * 全体の進み具合（0〜1）。文章（done / total）・判断（decided / total）・根拠（withEvidence / total）の分子と分母をそれぞれ足して割る。
 * リスク・機会・GHG・外部算定値は「何件あれば済み」が決まらないので含めない。分母が 0 なら 0。
 */
export const ssbjOverallProgress = (progress: SsbjReportProgress): { done: number; total: number; ratio: number } => {
  const done = progress.narratives.done + progress.judgements.decided + progress.evidence.withEvidence;
  const total = progress.narratives.total + progress.judgements.total + progress.evidence.total;
  return { done, total, ratio: total === 0 ? 0 : done / total };
};

/** レポートの中の画面のパス（SSBJ_REPORT_CONTENTS の path）ごとの、タブに添える数。 */
export type SsbjContentProgress = { text: string; ratio: number | null };

/**
 * タブに添える数。文章・判断・根拠は「済み/全体」と細いバー（ratio）、リスク・機会と外部算定値は件数、GHG は採用の有無。
 * 根拠は入力済みの文章が 0 件のとき「—」（バーなし）。
 * 数の無い画面（概要・プレビュー・保存履歴・操作履歴）は null。
 */
export const ssbjContentProgress = (path: string, progress: SsbjReportProgress): SsbjContentProgress | null => {
  const ratioOf = (done: number, total: number) => ({ text: `${done}/${total}`, ratio: total === 0 ? 0 : done / total });
  switch (path) {
    case 'narratives':
      return ratioOf(progress.narratives.done, progress.narratives.total);
    case 'judgements':
      return ratioOf(progress.judgements.decided, progress.judgements.total);
    case 'evidence':
      // 入力済みの文章が無いうちは、根拠を数える相手が無い（0/0 では済んだのか分からない）ので「—」にする。
      return progress.evidence.total === 0 ? { text: '—', ratio: null }
        : ratioOf(progress.evidence.withEvidence, progress.evidence.total);
    case 'risks':
      return { text: String(progress.risks.risk + progress.risks.opportunity), ratio: null };
    case 'external':
      return { text: String(progress.externalEmissions), ratio: null };
    case 'ghg':
      return { text: progress.ghgAdopted ? '採用済' : '未採用', ratio: null };
    default:
      return null;
  }
};

/** 次にやること 1 件（詳細画面の「レポートの内容」に出し、押すと path の画面へ移る）。 */
export type SsbjNextStep = { key: string; path: string; label: string; note: string | null };

/**
 * 次にやること。残っているものだけを、文章 → 判断 → 根拠 → GHG の順に返す（すべて済んでいれば空配列）。
 * 件数は ssbjReportProgress と同じ数え方。
 */
export const ssbjNextSteps = (progress: SsbjReportProgress): SsbjNextStep[] => {
  const { narratives, judgements, evidence } = progress;
  const steps: SsbjNextStep[] = [];
  if (narratives.unanswered > 0) {
    steps.push({ key: 'narratives-unanswered', path: 'narratives', label: `未入力の文章 ${narratives.unanswered} 件`, note: null });
  }
  if (narratives.unconfirmed > 0) {
    steps.push({
      key: 'narratives-unconfirmed',
      path: 'narratives',
      label: `未確認の文章 ${narratives.unconfirmed} 件`,
      note: narratives.placeholders > 0 ? `【 】が残る ${narratives.placeholders} 件` : null,
    });
  } else if (narratives.placeholders > 0) {
    steps.push({ key: 'narratives-placeholders', path: 'narratives', label: `【 】が残る文章 ${narratives.placeholders} 件`, note: null });
  }
  if (judgements.undecided > 0) {
    steps.push({ key: 'judgements-undecided', path: 'judgements', label: `未判断の要求 ${judgements.undecided} 件`, note: null });
  }
  if (judgements.needsReview > 0) {
    steps.push({ key: 'judgements-review', path: 'judgements', label: `要確認の判断 ${judgements.needsReview} 件`,
      note: '「要確認」で絞り込んで直す' });
  }
  const withoutEvidence = evidence.total - evidence.withEvidence;
  if (withoutEvidence > 0) {
    steps.push({ key: 'evidence', path: 'evidence', label: `根拠の無い入力済みの文章 ${withoutEvidence} 件`, note: null });
  }
  if (!progress.ghgAdopted) {
    steps.push({ key: 'ghg', path: 'ghg', label: 'OGT の GHG 排出量を採用していない', note: null });
  }
  return steps;
};
