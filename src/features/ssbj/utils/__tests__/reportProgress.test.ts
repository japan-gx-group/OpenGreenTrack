import { describe, expect, it } from 'vitest';
import {
  fictionalEvidence,
  fictionalExternalEmissions,
  fictionalSnapshot,
} from '../../__fixtures__/fictionalReport';
import type { SsbjNarrative, SsbjSnapshotSections } from '../../types';
import {
  ssbjContentProgress,
  ssbjNextSteps,
  ssbjOverallProgress,
  ssbjReportProgress,
  type SsbjReportProgress,
} from '../reportProgress';
import { SSBJ_NARRATIVE_ITEMS, SSBJ_REQUIREMENTS } from '../requirementMaster';

// 進み具合の数え方（タブ・詳細画面・依頼の前の点検表で共通）を、架空の検証データで確かめる。

const REQUIREMENT_ITEMS = SSBJ_NARRATIVE_ITEMS.filter(item => item.kind === 'requirement').length;

describe('ssbjReportProgress', () => {
  const progress = ssbjReportProgress(fictionalSnapshot.sections);

  it('文章は要求に答える項目だけを数え、行の無い項目は未入力、補足は数えない', () => {
    // 入力済み 2（監督する機関・内部炭素価格）、未確認 1（事業モデルへの影響）。補足の非該当は数えない。
    expect(progress.narratives).toEqual({
      total: REQUIREMENT_ITEMS,
      done: 2,
      answered: 2,
      notApplicable: 0,
      unconfirmed: 1,
      unanswered: REQUIREMENT_ITEMS - 3,
      placeholders: 0,
    });
  });

  it('非該当の文章は「済み」に数え、【 】が開示する文章か内部メモに残る項目を数える（補足も含む）', () => {
    const narratives: SsbjNarrative[] = [
      { itemId: 'governance.oversight_body', text: { disclosure: { state: 'not_applicable' }, internalNote: null } },
      { itemId: 'governance.oversight_information',
        text: { disclosure: { state: 'unconfirmed' }, internalNote: '取締役会に【頻度】報告している。' } },
      { itemId: 'governance.company_supplement',
        text: { disclosure: { state: 'answered', value: '【補足】' }, internalNote: null } },
    ];
    const result = ssbjReportProgress({ narratives });
    expect(result.narratives).toMatchObject({ done: 1, notApplicable: 1, unconfirmed: 1, answered: 0, placeholders: 2 });
    expect(result.narratives.unanswered).toBe(REQUIREMENT_ITEMS - 2);
  });

  it('判断は全要求を数え、判断済み・要確認・未判断に分ける（行の無い要求は未判断）', () => {
    // 判断済み: 経過措置の説明あり・非該当・重要性なし。要確認: 経過措置の説明が未確認・根拠が無い。
    expect(progress.judgements).toEqual({ total: SSBJ_REQUIREMENTS.length, decided: 3, needsReview: 2,
      undecided: SSBJ_REQUIREMENTS.length - 5 });
  });

  it('根拠は、入力済みの文章のうち根拠文書がある項目を数える（同じ項目の複数の根拠は 1 つ）', () => {
    expect(fictionalEvidence.every(evidence => evidence.itemId === 'governance.oversight_body')).toBe(true);
    expect(progress.evidence).toEqual({ total: 2, withEvidence: 1 });
  });

  it('リスク・機会・外部算定値の件数と、OGT の値の採用の有無を返す', () => {
    expect(progress.risks).toEqual({ risk: 2, opportunity: 1 });
    expect(progress.externalEmissions).toBe(fictionalExternalEmissions.length);
    expect(progress.ghgAdopted).toBe(true);
    expect(ssbjReportProgress({ ...fictionalSnapshot.sections, ghg: null }).ghgAdopted).toBe(false);
  });

  it('セクションが無い（その機能ができる前の版など）ときは、すべて未入力・未判断・0 件として数える', () => {
    const empty = ssbjReportProgress({} as Partial<SsbjSnapshotSections>);
    expect(empty.narratives.unanswered).toBe(REQUIREMENT_ITEMS);
    expect(empty.judgements.undecided).toBe(SSBJ_REQUIREMENTS.length);
    expect(empty.evidence).toEqual({ total: 0, withEvidence: 0 });
    expect(empty.ghgAdopted).toBe(false);
  });
});

describe('ssbjOverallProgress', () => {
  it('文章・判断・根拠の分子と分母を足して割る', () => {
    const progress = ssbjReportProgress(fictionalSnapshot.sections);
    const overall = ssbjOverallProgress(progress);
    expect(overall.done).toBe(2 + 3 + 1);
    expect(overall.total).toBe(REQUIREMENT_ITEMS + SSBJ_REQUIREMENTS.length + 2);
    expect(overall.ratio).toBeCloseTo(overall.done / overall.total);
  });
});

describe('ssbjContentProgress', () => {
  const progress = ssbjReportProgress(fictionalSnapshot.sections);

  it('文章・判断・根拠は「済み/全体」と割合、リスク・外部算定値は件数、GHG は採用の有無、それ以外は出さない', () => {
    expect(ssbjContentProgress('narratives', progress)).toEqual({ text: `2/${REQUIREMENT_ITEMS}`, ratio: 2 / REQUIREMENT_ITEMS });
    expect(ssbjContentProgress('judgements', progress)?.text).toBe(`3/${SSBJ_REQUIREMENTS.length}`);
    expect(ssbjContentProgress('evidence', progress)).toEqual({ text: '1/2', ratio: 0.5 });
    expect(ssbjContentProgress('risks', progress)).toEqual({ text: '3', ratio: null });
    expect(ssbjContentProgress('external', progress)?.text).toBe(String(fictionalExternalEmissions.length));
    expect(ssbjContentProgress('ghg', progress)?.text).toBe('採用済');
    for (const path of ['', 'preview', 'versions', 'history']) expect(ssbjContentProgress(path, progress)).toBeNull();
  });

  it('全体が 0 件なら割合は 0。根拠は入力済みの文章が 0 件なら「—」', () => {
    expect(ssbjContentProgress('narratives', { ...ssbjReportProgress({}), narratives: { ...ssbjReportProgress({}).narratives, total: 0 } }))
      .toEqual({ text: '0/0', ratio: 0 });
    expect(ssbjContentProgress('evidence', ssbjReportProgress({}))).toEqual({ text: '—', ratio: null });
  });
});

describe('ssbjNextSteps', () => {
  it('残っているものだけを、文章 → 判断 → 根拠 → GHG の順に、該当の画面へのパスと出す', () => {
    const steps = ssbjNextSteps(ssbjReportProgress(fictionalSnapshot.sections));
    expect(steps.map(step => [step.path, step.label])).toEqual([
      ['narratives', `未入力の文章 ${REQUIREMENT_ITEMS - 3} 件`],
      ['narratives', '未確認の文章 1 件'],
      ['judgements', `未判断の要求 ${SSBJ_REQUIREMENTS.length - 5} 件`],
      ['judgements', '要確認の判断 2 件'],
      ['evidence', '根拠の無い入力済みの文章 1 件'],
    ]);
  });

  it('【 】が残る項目は、未確認の文章に添える（未確認が無ければ 1 件として出す）。GHG を採用していなければ出す', () => {
    const base = ssbjReportProgress({});
    const done: SsbjReportProgress = {
      ...base,
      narratives: { ...base.narratives, unanswered: 0, unconfirmed: 2, placeholders: 1 },
      judgements: { ...base.judgements, undecided: 0 },
    };
    expect(ssbjNextSteps(done).map(step => [step.label, step.note])).toEqual([
      ['未確認の文章 2 件', '【 】が残る 1 件'],
      ['OGT の GHG 排出量を採用していない', null],
    ]);
    const onlyPlaceholders = { ...done, narratives: { ...done.narratives, unconfirmed: 0 }, ghgAdopted: true };
    expect(ssbjNextSteps(onlyPlaceholders).map(step => step.label)).toEqual(['【 】が残る文章 1 件']);
  });

  it('すべて済んでいれば空', () => {
    const base = ssbjReportProgress({});
    expect(ssbjNextSteps({
      ...base,
      narratives: { ...base.narratives, unanswered: 0 },
      judgements: { ...base.judgements, undecided: 0 },
      ghgAdopted: true,
    })).toEqual([]);
  });
});
