import { describe, expect, it } from 'vitest';
import { fictionalSnapshot } from '../../__fixtures__/fictionalReport';
import type { SsbjJudgement, SsbjNarrative, SsbjRequirementId } from '../../types';
import { emptySsbjJudgement } from '../judgement';
import { ssbjReportProgress } from '../reportProgress';
import { findSsbjNarrativeItem, SSBJ_NARRATIVE_ITEMS, SSBJ_REQUIREMENTS } from '../requirementMaster';
import { isSsbjChecklistFlagged, SSBJ_CONFLICT_RULES, ssbjConflicts, ssbjReviewChecklist, type SsbjConflict } from '../reviewChecklist';

// レビューを依頼する前の点検表: 判断と文章の食い違いの規則（規則ごと）と、点検表の行の組み立てを、架空の検証データで確かめる。

const judged = (requirementId: SsbjRequirementId, overrides: Partial<SsbjJudgement>): SsbjJudgement => ({
  ...emptySsbjJudgement(requirementId), ...overrides,
});
const answered = (itemId: SsbjNarrative['itemId']): SsbjNarrative => ({
  itemId, text: { disclosure: { state: 'answered', value: '架空の文章。' }, internalNote: null },
});
const REQUIREMENT_ITEMS = SSBJ_NARRATIVE_ITEMS.filter(item => item.kind === 'requirement').length;

// 監督する機関・責任者（governance.oversight_body）は REQ-GEN-001 と REQ-CLM-001 に答える。
const ITEM = 'governance.oversight_body' as const;
const [GEN, CLM] = findSsbjNarrativeItem(ITEM)?.requirementIds ?? [];

describe('ssbjConflicts（規則: 「非該当」なのに文章がある）', () => {
  const ofRule = (conflicts: SsbjConflict[]) => conflicts.filter(conflict => conflict.rule === 'not_applicable_with_text');

  it('項目が答える要求がすべて非該当で、文章が入力済みなら出す', () => {
    const conflicts = ofRule(ssbjConflicts({
      narratives: [answered(ITEM)],
      judgements: [judged(GEN, { applicability: 'not_applicable' }), judged(CLM, { applicability: 'not_applicable' })],
    }));
    expect(conflicts).toEqual([{ rule: 'not_applicable_with_text', itemId: ITEM, itemLabel: '監督する機関・責任者',
      requirementIds: [GEN, CLM] }]);
  });

  it('要求の一つでも非該当でない（該当・未確認・行が無い）なら出さない。文章が入力済みでなければ出さない', () => {
    expect(ofRule(ssbjConflicts({
      narratives: [answered(ITEM)],
      judgements: [judged(GEN, { applicability: 'not_applicable' })],
    }))).toEqual([]);
    expect(ofRule(ssbjConflicts({
      narratives: [{ itemId: ITEM, text: { disclosure: { state: 'not_applicable' }, internalNote: null } }],
      judgements: [judged(GEN, { applicability: 'not_applicable' }), judged(CLM, { applicability: 'not_applicable' })],
    }))).toEqual([]);
  });

  it('要求に答えない項目（企業固有の補足）は対象外', () => {
    expect(ofRule(ssbjConflicts({ narratives: [answered('governance.company_supplement')], judgements: [] }))).toEqual([]);
  });
});

describe('ssbjConflicts（規則: 「該当・重要性あり」なのに文章が未入力）', () => {
  const ofRule = (conflicts: SsbjConflict[]) => conflicts.filter(conflict => conflict.rule === 'material_without_text');

  it('要求のどれかが該当・重要性あり・記載するで、文章が未入力（行が無い）なら、その要求を挙げて出す', () => {
    const conflicts = ofRule(ssbjConflicts({
      narratives: [],
      judgements: [judged(CLM, { applicability: 'applicable', materiality: 'material' })],
    }));
    expect(conflicts).toEqual([{ rule: 'material_without_text', itemId: ITEM, itemLabel: '監督する機関・責任者', requirementIds: [CLM] }]);
  });

  it('文章が入力済み・未確認・非該当なら出さない（未確認は文章の行で知らせる）', () => {
    const judgements = [judged(GEN, { applicability: 'applicable', materiality: 'material' })];
    for (const disclosure of [{ state: 'answered', value: '架空。' }, { state: 'unconfirmed' }, { state: 'not_applicable' }] as const) {
      expect(ofRule(ssbjConflicts({ narratives: [{ itemId: ITEM, text: { disclosure, internalNote: null } }], judgements }))).toEqual([]);
    }
  });

  it('重要性なし・重要性が未確認・記載しない理由（経過措置など）を選んだ要求では出さない', () => {
    for (const overrides of [
      { applicability: 'applicable', materiality: 'not_material' },
      { applicability: 'applicable', materiality: 'unconfirmed' },
      { applicability: 'applicable', materiality: 'material', omissionReason: 'transition_relief' },
    ] as const) {
      expect(ofRule(ssbjConflicts({ narratives: [], judgements: [judged(GEN, overrides)] }))).toEqual([]);
    }
  });
});

describe('ssbjConflicts（架空の検証データ）', () => {
  it('食い違いは無い（比較情報は該当・重要性ありだが、経過措置で記載しない）', () => {
    expect(ssbjConflicts(fictionalSnapshot.sections)).toEqual([]);
  });

  it('規則の一覧は 2 つ', () => {
    expect(SSBJ_CONFLICT_RULES).toEqual(['not_applicable_with_text', 'material_without_text']);
  });
});

describe('ssbjReviewChecklist', () => {
  const progress = ssbjReportProgress(fictionalSnapshot.sections);
  const rowsOf = (ogt: Parameters<typeof ssbjReviewChecklist>[0]['ogt'], conflicts: SsbjConflict[] = []) =>
    ssbjReviewChecklist({ progress, conflicts, ogt });

  it('文章・判断・根拠は進み具合と同じ数で、残っていれば注意、該当の画面へのパスを持つ', () => {
    const rows = rowsOf({ adopted: true, isLoading: false, changedLabels: [] });
    expect(rows.map(row => [row.key, row.status, row.count, row.path])).toEqual([
      ['narratives', 'warning', REQUIREMENT_ITEMS - 3 + 1, 'narratives'],
      ['judgements', 'warning', SSBJ_REQUIREMENTS.length - 5 + 2, 'judgements'],
      ['evidence', 'warning', 1, 'evidence'],
      ['ogt', 'ok', 0, 'ghg'],
      ['conflict-not_applicable_with_text', 'ok', 0, 'judgements'],
      ['conflict-material_without_text', 'ok', 0, 'narratives'],
    ]);
    expect(rows[0].detail).toBe(`未入力 ${REQUIREMENT_ITEMS - 3}・未確認 1`);
    expect(rows[1].detail).toBe(`未判断 ${SSBJ_REQUIREMENTS.length - 5}・要確認 2`);
    expect(rows[3].detail).toBe('採用した値は最新');
  });

  it('すべて済んでいれば、文章・判断・根拠は ✓', () => {
    const done = {
      ...progress,
      narratives: { ...progress.narratives, unanswered: 0, unconfirmed: 0, placeholders: 0 },
      judgements: { ...progress.judgements, undecided: 0, needsReview: 0 },
      evidence: { total: 2, withEvidence: 2 },
    };
    const rows = ssbjReviewChecklist({ progress: done, conflicts: [], ogt: { adopted: true, isLoading: false, changedLabels: [] } });
    expect(rows.every(row => row.status === 'ok')).toBe(true);
    expect(rows.slice(0, 3).map(row => row.detail)).toEqual([
      'すべて入力済みか非該当', 'すべて判断済み', '入力済みの文章にすべて根拠文書がある',
    ]);
  });

  it('【 】だけが残る文章も注意にする', () => {
    const rows = ssbjReviewChecklist({
      progress: { ...progress, narratives: { ...progress.narratives, unanswered: 0, unconfirmed: 0, placeholders: 1 } },
      conflicts: [], ogt: { adopted: true, isLoading: false, changedLabels: [] },
    });
    // 未入力・未確認が無いときの件数は【 】の残る項目の数。
    expect([rows[0].status, rows[0].count, rows[0].detail]).toEqual(['warning', 1, '【 】が残る 1']);
  });

  it('OGT の値: 採用した後に変わった区分・採用していない・比べられなかったときは注意', () => {
    expect(rowsOf({ adopted: true, isLoading: false, changedLabels: ['Scope 1', 'Scope 2'] })[3]).toMatchObject({
      status: 'warning', count: 2, detail: '採用した後に変わった: Scope 1、Scope 2',
    });
    expect(rowsOf({ adopted: false })[3]).toMatchObject({ status: 'warning', count: null, detail: 'GHG 排出量を採用していない' });
    expect(rowsOf({ adopted: true, isLoading: false, changedLabels: null })[3]).toMatchObject({ status: 'warning', count: null });
  });

  it('OGT の最新の値を読んでいる間は「確認中」にし、注意に数えない', () => {
    const row = rowsOf({ adopted: true, isLoading: true, changedLabels: null })[3];
    expect(row).toMatchObject({ status: 'checking', count: null, detail: '最新の値と比べています' });
    expect(isSsbjChecklistFlagged(row)).toBe(false);
  });

  it('食い違いは規則ごとの行に、要確認として件数と項目名を出す', () => {
    const conflicts: SsbjConflict[] = [
      { rule: 'not_applicable_with_text', itemId: ITEM, itemLabel: '監督する機関・責任者', requirementIds: [GEN, CLM] },
      { rule: 'not_applicable_with_text', itemId: 'strategy.business_model_impact', itemLabel: '事業モデルへの影響', requirementIds: [] },
    ];
    const rows = rowsOf({ adopted: true, isLoading: false, changedLabels: [] }, conflicts);
    expect(rows[4]).toMatchObject({ status: 'review', count: 2, label: '「非該当」なのに文章がある',
      detail: '監督する機関・責任者、事業モデルへの影響' });
    expect(rows[5]).toMatchObject({ status: 'ok', count: 0, label: '「該当・重要性あり」なのに文章が未入力' });
  });
});
