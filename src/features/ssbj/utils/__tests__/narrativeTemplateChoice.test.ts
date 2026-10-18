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
const riskProcess = findSsbjNarrativeChoiceTemplate('risk_management.risk_process')!;

describe('テンプレートの定義', () => {
  it('要求項目マスターにある要求の項目だけに付け、四本柱のすべての章に代表の項目がある', () => {
    for (const template of SSBJ_NARRATIVE_CHOICE_TEMPLATES) {
      expect(findSsbjNarrativeItem(template.itemId)?.kind).toBe('requirement');
    }
    const sections = new Set(SSBJ_NARRATIVE_CHOICE_TEMPLATES.map(template => sectionOfItem(template.itemId)));
    expect([...sections].sort()).toEqual([...SSBJ_SECTION_IDS].sort());
  });

  it('文型の {欄 ID} はすべて定義された欄で、欄はすべて文型に使われている', () => {
    for (const template of SSBJ_NARRATIVE_CHOICE_TEMPLATES) {
      const used = [...template.pattern.matchAll(/\{([a-z_]+)\}/g)].map(match => match[1]);
      expect(new Set(used)).toEqual(new Set(template.slots.map(slot => slot.id)));
    }
  });
});

describe('buildSsbjNarrativeDraft', () => {
  it('選んだ値と補足入力から下書きを作る', () => {
    expect(buildSsbjNarrativeDraft(oversightBody, input({ body: 'board' })))
      .toBe('サステナビリティ関連（気候関連を含む）のリスク及び機会は、取締役会が監督している。');
    expect(buildSsbjNarrativeDraft(oversightBody, input({ body: 'other' }, { body: '経営会議' })))
      .toBe('サステナビリティ関連（気候関連を含む）のリスク及び機会は、経営会議が監督している。');
  });

  it('選んでいない欄は【欄の名前】のまま残し、根拠のない値で埋めない', () => {
    const draft = buildSsbjNarrativeDraft(riskProcess, input({ frequency: 'yearly' }));
    expect(draft.startsWith('年 1 回、【識別の方法】でリスクを識別し')).toBe(true);
    expect(ssbjTemplatePlaceholders(draft)).toEqual(['【識別の方法】', '【評価の基準】', '【シナリオ分析】', '【前期からの変更】']);
    expect(unfilledSsbjTemplateSlots(riskProcess, input({ frequency: 'yearly' })))
      .toEqual(['識別の方法', '評価の基準', 'シナリオ分析', '前期からの変更']);
  });

  it('「その他」を選んで何も入力していなければ【欄の名前】、空白だけの補足も入力していない扱い', () => {
    expect(buildSsbjNarrativeDraft(oversightBody, input({ body: 'other' }, { body: '  ' })))
      .toContain('【監督する機関・責任者】');
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
    expect(validateSsbjNarrativeTemplateInput('governance.oversight_body', { version: 'r2-trial-0', choices: { body: 'old' }, texts: {} }))
      .toEqual([]);
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
    expect(describeSsbjNarrativeTemplateInput('governance.oversight_body', input({ body: 'board' })))
      .toEqual([{ label: '監督する機関・責任者', value: '取締役会' }]);
    expect(describeSsbjNarrativeTemplateInput('governance.oversight_body', { version: 'old', choices: { body: 'board' }, texts: {} }))
      .toEqual([]);
    expect(describeSsbjNarrativeTemplateInput('governance.oversight_body', null)).toEqual([]);
  });
});
