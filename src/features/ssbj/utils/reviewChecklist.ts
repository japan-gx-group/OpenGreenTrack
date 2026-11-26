// レビューを依頼する前の点検表（詳細画面の「状態と承認」で、依頼ボタンの上に出す）の純関数。
// 未入力・未確認の文章、未判断・要確認の要求、根拠の無い項目、採用した OGT の値の変化と、判断と文章の食い違いを並べる。
// 依頼は止めず、知らせるだけにする（未確認のまま出すのが正しい場合もあるため）。
// 件数の数え方は進み具合（utils/reportProgress.ts）と共通。食い違いの規則は SSBJ_CONFLICT_RULES に一覧にし、規則ごとにテストする。
// 説明は docs/ssbj-spec.md §13「依頼の前の点検表」にも書く（変えたら両方を直す）。

import type { SsbjItemId, SsbjJudgement, SsbjRequirementId, SsbjSnapshotSections } from '../types';
import { emptySsbjJudgement } from './judgement';
import type { SsbjReportProgress } from './reportProgress';
import { SSBJ_NARRATIVE_ITEMS } from './requirementMaster';

/** 判断と文章の食い違いの規則。 */
export const SSBJ_CONFLICT_RULES = ['not_applicable_with_text', 'material_without_text'] as const;
export type SsbjConflictRule = (typeof SSBJ_CONFLICT_RULES)[number];

/**
 * 規則ごとの見出しと、直しに行く画面。要求と文章の項目の対応は要求項目マスターの requirementIds。
 * - not_applicable_with_text: 項目が答える要求がすべて「非該当」なのに、開示する文章が入力済み（判断か文章のどちらかが違う）
 * - material_without_text: 項目が答える要求のどれかが「該当・重要性あり・記載する」なのに、開示する文章が未入力（行が無い項目を含む）。
 *   記載しない理由（経過措置など）を選んだ要求は、記載しない旨を判断の画面で説明するので数えない
 */
export const SSBJ_CONFLICT_RULE_DEFINITIONS: Record<SsbjConflictRule, { label: string; path: string }> = {
  not_applicable_with_text: { label: '「非該当」なのに文章がある', path: 'judgements' },
  material_without_text: { label: '「該当・重要性あり」なのに文章が未入力', path: 'narratives' },
};

/** 食い違い 1 件（文章の項目ごと）。 */
export type SsbjConflict = { rule: SsbjConflictRule; itemId: SsbjItemId; itemLabel: string; requirementIds: SsbjRequirementId[] };

const judgementOf = (judgements: ReadonlyMap<SsbjRequirementId, SsbjJudgement>, id: SsbjRequirementId) =>
  judgements.get(id) ?? emptySsbjJudgement(id);

/** 判断と文章の食い違いを、規則ごと・マスターの項目の順に返す（企業固有の補足は要求に答えないので対象外）。 */
export const ssbjConflicts = (sections: Partial<SsbjSnapshotSections>): SsbjConflict[] => {
  const judgements = new Map((sections.judgements ?? []).map(judgement => [judgement.requirementId, judgement]));
  const states = new Map((sections.narratives ?? []).map(narrative => [narrative.itemId, narrative.text.disclosure.state]));
  const conflicts: SsbjConflict[] = [];
  for (const rule of SSBJ_CONFLICT_RULES) {
    for (const item of SSBJ_NARRATIVE_ITEMS) {
      if (item.requirementIds.length === 0) continue;
      const state = states.get(item.id) ?? 'unanswered';
      const related = item.requirementIds.map(id => judgementOf(judgements, id));
      const matched = rule === 'not_applicable_with_text'
        ? (state === 'answered' && related.every(judgement => judgement.applicability === 'not_applicable') ? related : [])
        : (state === 'unanswered' ? related.filter(judgement => judgement.applicability === 'applicable' &&
            judgement.materiality === 'material' && judgement.omissionReason === 'none') : []);
      if (matched.length > 0) {
        conflicts.push({ rule, itemId: item.id, itemLabel: item.label, requirementIds: matched.map(judgement => judgement.requirementId) });
      }
    }
  }
  return conflicts;
};

/**
 * 点検表の行の状態。ok = ✓ / warning = 注意（残っているもの）/ review = 要確認（判断と文章の食い違い）/
 * checking = 確認中（OGT の最新の値を読んでいる間。注意には数えない）。
 */
export type SsbjChecklistStatus = 'ok' | 'warning' | 'review' | 'checking';

export const SSBJ_CHECKLIST_STATUS_LABELS: Record<SsbjChecklistStatus, string> = {
  ok: '✓', warning: '注意', review: '要確認', checking: '確認中',
};

/** 注意か要確認の行か（見出しの「n 項目に注意」に数える）。 */
export const isSsbjChecklistFlagged = (row: SsbjChecklistRow): boolean => row.status === 'warning' || row.status === 'review';

/** 点検表の 1 行。count は残っている件数（件数で表せない行は null）。path は直しに行く画面（SSBJ_REPORT_CONTENTS の path）。 */
export type SsbjChecklistRow = {
  key: string;
  status: SsbjChecklistStatus;
  label: string;
  detail: string;
  count: number | null;
  path: string;
};

/**
 * 採用した OGT の値の状態。adopted = false: 採用していない / isLoading: 最新の値を読んでいる /
 * changedLabels: 採用した後に変わった区分の名前（utils/ogtAdoption.ts の changedOgtValueLabels。空なら最新。
 * 読み終わって null なら、最新の値を読めず比べられなかった）。
 */
export type SsbjOgtChangeState = { adopted: false } | { adopted: true; isLoading: boolean; changedLabels: string[] | null };

const parts = (values: [string, number][]): string =>
  values.filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}`).join('・');

/** 点検表の行（文章 → 判断 → 根拠 → OGT の値 → 食い違いの規則の順。すべての行を出し、済んだ行は ✓ にする）。 */
export const ssbjReviewChecklist = (input: {
  progress: SsbjReportProgress;
  conflicts: readonly SsbjConflict[];
  ogt: SsbjOgtChangeState;
}): SsbjChecklistRow[] => {
  const { narratives, judgements, evidence } = input.progress;
  const rows: SsbjChecklistRow[] = [];

  // 件数は未入力＋未確認。どちらも無く【 】だけが残るときは【 】の残る項目の数（【 】の項目は未確認に含まれることが多いので足さない）。
  const narrativeCount = narratives.unanswered + narratives.unconfirmed;
  rows.push({
    key: 'narratives',
    status: narrativeCount > 0 || narratives.placeholders > 0 ? 'warning' : 'ok',
    label: '文章',
    detail: parts([['未入力', narratives.unanswered], ['未確認', narratives.unconfirmed], ['【 】が残る', narratives.placeholders]]) ||
      'すべて入力済みか非該当',
    count: narrativeCount > 0 ? narrativeCount : narratives.placeholders,
    path: 'narratives',
  });

  const judgementCount = judgements.undecided + judgements.needsReview;
  rows.push({
    key: 'judgements',
    status: judgementCount > 0 ? 'warning' : 'ok',
    label: '判断',
    detail: parts([['未判断', judgements.undecided], ['要確認', judgements.needsReview]]) || 'すべて判断済み',
    count: judgementCount,
    path: 'judgements',
  });

  const withoutEvidence = evidence.total - evidence.withEvidence;
  rows.push({
    key: 'evidence',
    status: withoutEvidence > 0 ? 'warning' : 'ok',
    label: '根拠',
    detail: withoutEvidence > 0 ? `根拠文書の無い入力済みの文章 ${withoutEvidence}` : '入力済みの文章にすべて根拠文書がある',
    count: withoutEvidence,
    path: 'evidence',
  });

  const { ogt } = input;
  rows.push(!ogt.adopted
    ? { key: 'ogt', status: 'warning', label: 'OGT の値', detail: 'GHG 排出量を採用していない', count: null, path: 'ghg' }
    : ogt.isLoading
      ? { key: 'ogt', status: 'checking', label: 'OGT の値', detail: '最新の値と比べています', count: null, path: 'ghg' }
    : ogt.changedLabels === null
      ? { key: 'ogt', status: 'warning', label: 'OGT の値', detail: '最新の値と比べられなかった（GHG の画面で確かめる）', count: null, path: 'ghg' }
      : ogt.changedLabels.length > 0
        ? { key: 'ogt', status: 'warning', label: 'OGT の値',
          detail: `採用した後に変わった: ${ogt.changedLabels.join('、')}`, count: ogt.changedLabels.length, path: 'ghg' }
        : { key: 'ogt', status: 'ok', label: 'OGT の値', detail: '採用した値は最新', count: 0, path: 'ghg' });

  for (const rule of SSBJ_CONFLICT_RULES) {
    const matched = input.conflicts.filter(conflict => conflict.rule === rule);
    rows.push({
      key: `conflict-${rule}`,
      status: matched.length > 0 ? 'review' : 'ok',
      label: SSBJ_CONFLICT_RULE_DEFINITIONS[rule].label,
      detail: matched.length > 0 ? matched.map(conflict => conflict.itemLabel).join('、') : '食い違いは無い',
      count: matched.length,
      path: SSBJ_CONFLICT_RULE_DEFINITIONS[rule].path,
    });
  }
  return rows;
};
