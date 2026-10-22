import { describe, expect, it } from 'vitest';
import type { SsbjNarrativeTemplateInput } from '../../types';
import { ssbjTemplatePlaceholders } from '../narrative';
import {
  SSBJ_NARRATIVE_CHOICE_TEMPLATES,
  SSBJ_NARRATIVE_CHOICE_TEMPLATE_VERSION,
  SSBJ_TEMPLATE_TEXT_MAX_LENGTH,
  buildSsbjNarrativeDraft,
  describeSsbjNarrativeTemplateInput,
  emptySsbjNarrativeTemplateInput,
  findSsbjNarrativeChoiceTemplate,
  normalizeSsbjNarrativeTemplateInput,
  parseSsbjNarrativeTemplateInput,
  unfilledSsbjTemplateSlots,
  validateSsbjNarrativeTemplateInput,
} from '../narrativeTemplateChoice';
import { SSBJ_SECTION_IDS } from '../../types';
import { findSsbjNarrativeItem } from '../requirementMaster';
import { sectionOfItem } from '../ids';

const input = (choices: Record<string, string>, texts: Record<string, string> = {}): SsbjNarrativeTemplateInput => ({
  version: SSBJ_NARRATIVE_CHOICE_TEMPLATE_VERSION,
  choices,
  texts,
});

const oversightBody = findSsbjNarrativeChoiceTemplate('governance.oversight_body')!;
const oversightInformation = findSsbjNarrativeChoiceTemplate('governance.oversight_information')!;
const businessImpact = findSsbjNarrativeChoiceTemplate('strategy.business_model_impact')!;
const riskProcess = findSsbjNarrativeChoiceTemplate('risk_management.risk_process')!;
const measurementMethod = findSsbjNarrativeChoiceTemplate('metrics_targets.ghg_measurement_method')!;

describe('テンプレートの定義', () => {
  it('要求項目マスターにある要求の項目だけに付け、四本柱のすべての章に代表の項目がある', () => {
    for (const template of SSBJ_NARRATIVE_CHOICE_TEMPLATES) {
      expect(findSsbjNarrativeItem(template.itemId)?.kind).toBe('requirement');
    }
    const sections = new Set(SSBJ_NARRATIVE_CHOICE_TEMPLATES.map(template => sectionOfItem(template.itemId)));
    expect([...sections].sort()).toEqual([...SSBJ_SECTION_IDS].sort());
  });

  it('文型・選択肢の文の {欄 ID} はすべて定義された欄で、欄はすべてどこかで使われている', () => {
    for (const template of SSBJ_NARRATIVE_CHOICE_TEMPLATES) {
      const texts = [template.pattern, ...template.slots.flatMap(slot => (slot.kind === 'choice' ? slot.options.map(option => option.text) : []))];
      const used = texts.flatMap(text => [...text.matchAll(/\{([a-z_]+)\}/g)].map(match => match[1]));
      expect(new Set(used)).toEqual(new Set(template.slots.map(slot => slot.id)));
    }
  });

  it('選択肢の文が「。」で終わる欄は、文の欄（sentence）にし、文の欄の選択肢はすべて文で終わる', () => {
    for (const template of SSBJ_NARRATIVE_CHOICE_TEMPLATES) {
      for (const slot of template.slots) {
        if (slot.kind !== 'choice') continue;
        const texts = slot.options.map(option => option.text);
        if (texts.some(text => text.endsWith('。'))) expect(slot.sentence, `${template.itemId} の ${slot.id}`).toBe(true);
        if (slot.sentence) for (const text of texts) expect(text).toMatch(/[。】]$/);
      }
    }
  });

  it('文型の固定の部分に、会社によって違う事実を書かない（レビューで指摘された言い切り）', () => {
    const patterns = SSBJ_NARRATIVE_CHOICE_TEMPLATES.map(template => template.pattern).join('\n');
    for (const phrase of ['集中している', '評価・優先順位付けしている', '前期からプロセスを', 'サステナビリティ関連', '報告している', '温室効果ガス排出は']) {
      expect(patterns).not.toContain(phrase);
    }
  });

  it('事実の有無を選ぶ欄は、否定・未特定・初年度も選べる', () => {
    const optionIds = (template: typeof riskProcess, slotId: string) => {
      const slot = template.slots.find(candidate => candidate.id === slotId);
      return slot?.kind === 'choice' ? slot.options.map(option => option.id) : [];
    };
    expect(optionIds(businessImpact, 'concentration')).toEqual(expect.arrayContaining(['spread', 'unidentified']));
    expect(optionIds(riskProcess, 'assessment')).toContain('not_prioritized');
    expect(optionIds(riskProcess, 'change')).toContain('first_year');
    expect(optionIds(oversightInformation, 'reporting')).toContain('not_reported');
    expect(optionIds(oversightBody, 'scope')).toContain('climate');
    expect(optionIds(measurementMethod, 'scope')).toEqual(['scope_1_2', 'scope_1_2_3']);
  });
});

describe('buildSsbjNarrativeDraft', () => {
  it('選んだ値と補足入力から下書きを作る', () => {
    expect(buildSsbjNarrativeDraft(oversightBody, input({ scope: 'sustainability', body: 'board' })))
      .toBe('サステナビリティ関連（気候関連を含む）のリスク及び機会は、取締役会が監督している。');
    expect(buildSsbjNarrativeDraft(oversightBody, input({ scope: 'climate', body: 'other' }, { body: '経営会議' })))
      .toBe('気候関連のリスク及び機会は、経営会議が監督している。');
  });

  it('選択肢の文の {欄 ID} は、その選択肢を選んだときだけ使い、使わない欄は残りに数えない', () => {
    const reported = input({ reporting: 'reported', frequency: 'yearly', body: 'board', content: 'target_progress' }, { reporter: '管理本部長' });
    expect(buildSsbjNarrativeDraft(oversightInformation, reported)).toBe('管理本部長が年 1 回、取締役会に目標の進捗を報告している。');
    expect(unfilledSsbjTemplateSlots(oversightInformation, reported)).toEqual([]);

    const notReported = input({ reporting: 'not_reported' });
    expect(buildSsbjNarrativeDraft(oversightInformation, notReported)).not.toContain('報告している');
    expect(unfilledSsbjTemplateSlots(oversightInformation, notReported)).toEqual([]);
    expect(unfilledSsbjTemplateSlots(oversightInformation, input({}))).toEqual(['定期的な報告']);
  });

  it('補足入力の文字列にある {…} は置き換えない', () => {
    expect(buildSsbjNarrativeDraft(oversightBody, input({ scope: 'other', body: 'board' }, { scope: '{body}' })))
      .toBe('{body}は、取締役会が監督している。');
  });

  it('初年度の会社も、前期の有無を言い切らずに書ける', () => {
    const draft = buildSsbjNarrativeDraft(riskProcess, input({ change: 'first_year' }));
    expect(draft).toContain('当期が初めての開示のため');
    expect(draft).not.toContain('前期からプロセスを');
  });

  it('選んでいない欄は【欄の名前】のまま残し、根拠のない値で埋めない', () => {
    const draft = buildSsbjNarrativeDraft(riskProcess, input({ frequency: 'yearly' }));
    expect(draft.startsWith('年 1 回、【識別の方法】でリスクを識別している。')).toBe(true);
    expect(ssbjTemplatePlaceholders(draft)).toEqual(['【識別の方法】', '【評価・優先順位付け】', '【シナリオ分析】', '【前期からの変更】']);
    expect(unfilledSsbjTemplateSlots(riskProcess, input({ frequency: 'yearly' })))
      .toEqual(['識別の方法', '評価・優先順位付け', 'シナリオ分析', '前期からの変更']);
  });

  it('文の欄で「その他」に入力した文が「。」で終わっていなければ足し、次の文とつながらないようにする', () => {
    const choices = { frequency: 'yearly', method: 'hearing', assessment: 'other', scenario: 'not_used', change: 'unchanged' };
    expect(buildSsbjNarrativeDraft(riskProcess, input(choices, { assessment: '重要度で評価している' }))).toBe(
      '年 1 回、各部門へのヒアリングでリスクを識別している。重要度で評価している。' +
      'リスクの識別・評価に、シナリオ分析は用いていない。前期からプロセスを変更していない。',
    );
    // 既に文で終わっていれば足さない。
    expect(buildSsbjNarrativeDraft(riskProcess, input(choices, { assessment: '重要度で評価している。' })))
      .toContain('識別している。重要度で評価している。リスクの識別・評価に');
    expect(buildSsbjNarrativeDraft(oversightInformation, input({ reporting: 'other' }, { reporting: '必要に応じて報告している' })))
      .toBe('必要に応じて報告している。');
    // 文の途中に入る欄には足さない。
    expect(buildSsbjNarrativeDraft(oversightBody, input({ scope: 'climate', body: 'other' }, { body: '経営会議' })))
      .toBe('気候関連のリスク及び機会は、経営会議が監督している。');
  });

  it('「その他」を選んで何も入力していなければ【欄の名前】、空白だけの補足も入力していない扱い', () => {
    expect(buildSsbjNarrativeDraft(oversightBody, input({ body: 'other' }, { body: '  ' })))
      .toContain('【監督する機関・責任者】');
  });

  it('測定方法の文は、選んだスコープについてだけ書き、すべての排出を 1 つの方法で測ったと言い切らない', () => {
    expect(buildSsbjNarrativeDraft(measurementMethod, input({ scope: 'scope_1_2', method: 'shk', reason: 'parent' }))).toBe(
      'スコープ 1・2 の温室効果ガス排出は、温対法の算定・報告・公表制度（SHK 制度）の方法で測定している。' +
      'この方法を選んだ理由は、親会社の指定に従ったためである。',
    );
    expect(buildSsbjNarrativeDraft(measurementMethod, input({ method: 'ghg_protocol' })))
      .toBe('【対象のスコープ】は、GHG プロトコルの方法で測定している。この方法を選んだ理由は、【この方法を選んだ理由】である。');
  });

  it('揃える先の報告を理由にするときは、どの測定方法とも食い違わない言い方にし、報告の名称は【 】で残す', () => {
    const draft = buildSsbjNarrativeDraft(
      measurementMethod, input({ scope: 'scope_1_2_3', method: 'ghg_protocol', reason: 'existing_reporting' }),
    );
    expect(draft).toContain('既に行っている【報告の名称】と測定方法を揃えるため');
    expect(draft).not.toContain('法令');
  });

  it('影響の集中が未特定のときは、集中があることを前提にしない', () => {
    expect(buildSsbjNarrativeDraft(businessImpact, input(
      { impact: 'cost_increase', timing: 'expected', concentration: 'unidentified' },
      { driver: '電力価格の上昇', business: '主力の金属加工品' },
    ))).toBe(
      '電力価格の上昇により、主力の金属加工品において製造原価の上昇が生じることが見込まれる。' +
      '影響が特定の事業所・地域・工程に集中しているかは、まだ特定できていない。',
    );
  });

  it('シナリオ分析は何に用いるかを書き、頻度は「四半期ごとに」でつなぐ', () => {
    expect(buildSsbjNarrativeDraft(riskProcess, input({
      frequency: 'quarterly', method: 'meeting', assessment: 'impact_only', scenario: 'used', change: 'unchanged',
    }))).toBe(
      '四半期ごとに、部門横断の会議でリスクを識別している。識別したリスクは、影響の大きさで評価し、優先順位を付けている。' +
      'リスクの識別・評価に、シナリオ分析を用いている。前期からプロセスを変更していない。',
    );
  });

  it('何も選んでいなければ、すべての欄が【 】になる', () => {
    const draft = buildSsbjNarrativeDraft(riskProcess, emptySsbjNarrativeTemplateInput());
    expect(ssbjTemplatePlaceholders(draft)).toHaveLength(riskProcess.slots.length);
  });
});

describe('normalizeSsbjNarrativeTemplateInput', () => {
  it('空の選択・空の補足、「その他」以外の選択肢の補足を落とす。何も無ければ null', () => {
    expect(normalizeSsbjNarrativeTemplateInput(input({ body: 'board', x: '' }, { body: '経営会議' })))
      .toEqual(input({ body: 'board' }));
    expect(normalizeSsbjNarrativeTemplateInput(input({ body: 'other' }, { body: ' 経営会議 ' })))
      .toEqual(input({ body: 'other' }, { body: '経営会議' }));
    expect(normalizeSsbjNarrativeTemplateInput(input({ body: '' }, { reporter: ' ' }))).toBeNull();
    expect(normalizeSsbjNarrativeTemplateInput(null)).toBeNull();
  });
});

describe('validateSsbjNarrativeTemplateInput', () => {
  it('定義にある選択肢・欄だけを受け付ける', () => {
    expect(validateSsbjNarrativeTemplateInput('governance.oversight_body', input({ body: 'board' }))).toEqual([]);
    expect(validateSsbjNarrativeTemplateInput('governance.oversight_body', input({ body: 'unknown' }))).not.toEqual([]);
    expect(validateSsbjNarrativeTemplateInput('governance.oversight_body', input({ unknown: 'board' }))).not.toEqual([]);
    expect(validateSsbjNarrativeTemplateInput('governance.oversight_body', input({}, { unknown: 'x' }))).not.toEqual([]);
  });

  it('「その他」を持たない欄では「その他」を受け付けない', () => {
    expect(validateSsbjNarrativeTemplateInput('risk_management.risk_process', input({ scenario: 'other' }))).not.toEqual([]);
  });

  it('補足入力の長さを制限する', () => {
    const long = 'あ'.repeat(SSBJ_TEMPLATE_TEXT_MAX_LENGTH + 1);
    expect(validateSsbjNarrativeTemplateInput('governance.oversight_information', input({}, { reporter: long })))
      .toEqual([`「報告する人の役職」は${SSBJ_TEMPLATE_TEXT_MAX_LENGTH}文字以内で入力してください`]);
  });

  it('テンプレートの無い項目に選択は保存できない。選択が無ければ（null）どの項目でもよい', () => {
    expect(validateSsbjNarrativeTemplateInput('governance.management_role', input({ body: 'board' }))).not.toEqual([]);
    expect(validateSsbjNarrativeTemplateInput('governance.management_role', null)).toEqual([]);
  });

  it('以前の版の選択は、今の選択肢として検証せずに残す', () => {
    expect(validateSsbjNarrativeTemplateInput('governance.oversight_body', { version: 'r2-trial-1', choices: { body: 'old' }, texts: {} }))
      .toEqual([]);
    expect(validateSsbjNarrativeTemplateInput(
      'metrics_targets.ghg_measurement_method', { version: 'r2-trial-2', choices: { reason: 'legal_reporting' }, texts: {} },
    )).toEqual([]);
  });
});

describe('parseSsbjNarrativeTemplateInput と describeSsbjNarrativeTemplateInput', () => {
  it('形の違う値は null', () => {
    expect(parseSsbjNarrativeTemplateInput(input({ body: 'board' }))).toEqual(input({ body: 'board' }));
    expect(parseSsbjNarrativeTemplateInput(null)).toBeNull();
    expect(parseSsbjNarrativeTemplateInput({ version: 'r2-trial-1', choices: { body: 1 }, texts: {} })).toBeNull();
    expect(parseSsbjNarrativeTemplateInput({ version: 'r2-trial-1', choices: {} })).toBeNull();
  });

  it('選んだ欄だけを「欄の名前: 値」で出し、以前の版の選択は出さない', () => {
    expect(describeSsbjNarrativeTemplateInput('governance.oversight_body', input({ body: 'board_committee' })))
      .toEqual([{ label: '監督する機関・責任者', value: '取締役会の下に設けた委員会' }]);
    expect(describeSsbjNarrativeTemplateInput('governance.oversight_body', input({ body: 'other' }, { body: '経営会議' })))
      .toEqual([{ label: '監督する機関・責任者', value: '経営会議' }]);
    expect(describeSsbjNarrativeTemplateInput('governance.oversight_body', { version: 'old', choices: { body: 'board' }, texts: {} }))
      .toEqual([]);
    expect(describeSsbjNarrativeTemplateInput('governance.oversight_body', null)).toEqual([]);
  });
});
