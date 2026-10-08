import { describe, expect, it } from 'vitest';
import { fictionalNarratives } from '../../__fixtures__/fictionalReport';
import type { SsbjNarrative } from '../../types';
import {
  EMPTY_SSBJ_DISCLOSABLE_TEXT,
  normalizeSsbjNarrativeInput,
  ssbjNarrativeEntriesOfSection,
  mergeSsbjNarrativeDrafts,
  ssbjNarrativeTextWillBeDiscarded,
  ssbjTemplatePlaceholders,
  toSsbjNarrativeFormValues,
  validateSsbjNarrativeInput,
} from '../narrative';
import { findSsbjNarrativeItem, ssbjNarrativeItemsOfSection } from '../requirementMaster';

describe('入力の正規化と検証', () => {
  it('入力済みのときだけ本文を残し、前後の空白を落とし、空の内部メモは null にする', () => {
    expect(normalizeSsbjNarrativeInput({ state: 'answered', text: ' 本文 ', internalNote: '  ' }))
      .toEqual({ disclosure: { state: 'answered', value: '本文' }, internalNote: null });
    expect(normalizeSsbjNarrativeInput({ state: 'unconfirmed', text: '下書き', internalNote: 'メモ' }))
      .toEqual({ disclosure: { state: 'unconfirmed' }, internalNote: 'メモ' });
  });

  it('入力済みなのに本文が空、マスターに無い項目はエラー', () => {
    const empty = normalizeSsbjNarrativeInput({ state: 'answered', text: '  ', internalNote: '' });
    expect(validateSsbjNarrativeInput('governance.oversight_body', empty)).not.toEqual([]);
    const ok = normalizeSsbjNarrativeInput({ state: 'answered', text: '本文', internalNote: '' });
    expect(validateSsbjNarrativeInput('governance.oversight_body', ok)).toEqual([]);
    expect(validateSsbjNarrativeInput('governance.unknown_item', ok)).toContain('要求項目マスターに無い項目です');
  });

  it('テンプレートの【 】が残ったまま入力済みにはできず、書きかけは内部メモに移すよう案内する', () => {
    const template = findSsbjNarrativeItem('governance.oversight_body')!.template;
    const answered = normalizeSsbjNarrativeInput({ state: 'answered', text: template, internalNote: '' });
    const message = validateSsbjNarrativeInput('governance.oversight_body', answered).join();
    expect(message).toContain('【 】の部分（1 か所）');
    // 「未確認」では本文を保存しないので、「未確認にすれば下書きを保存できる」とは案内しない。
    expect(message).toContain('文章を内部メモに移してから、状態を「未確認」にして保存してください');
    const draft = normalizeSsbjNarrativeInput({ state: 'unconfirmed', text: template, internalNote: '' });
    expect(validateSsbjNarrativeInput('governance.oversight_body', draft)).toEqual([]);
    expect(draft.disclosure).toEqual({ state: 'unconfirmed' });
    expect(ssbjTemplatePlaceholders('【A】と【B】')).toEqual(['【A】', '【B】']);
  });

  it('入力済み以外の状態で、入力した本文があるときだけ「本文が消える」とする', () => {
    expect(ssbjNarrativeTextWillBeDiscarded({ state: 'unconfirmed', text: '書きかけ', internalNote: '' })).toBe(true);
    expect(ssbjNarrativeTextWillBeDiscarded({ state: 'not_applicable', text: '書きかけ', internalNote: '' })).toBe(true);
    expect(ssbjNarrativeTextWillBeDiscarded({ state: 'unanswered', text: '書きかけ', internalNote: '' })).toBe(true);
    expect(ssbjNarrativeTextWillBeDiscarded({ state: 'unconfirmed', text: '  ', internalNote: 'メモ' })).toBe(false);
    expect(ssbjNarrativeTextWillBeDiscarded({ state: 'answered', text: '本文', internalNote: '' })).toBe(false);
  });

  it('保存済みの文章からフォームへ戻せる', () => {
    expect(toSsbjNarrativeFormValues(fictionalNarratives[0].text)).toEqual({
      state: 'answered',
      text: '当社では、取締役会が気候関連のリスク及び機会を監督している。',
      internalNote: '親会社のサステナビリティ委員会との関係は確認中（架空）。',
    });
    expect(toSsbjNarrativeFormValues(EMPTY_SSBJ_DISCLOSABLE_TEXT)).toEqual({ state: 'unanswered', text: '', internalNote: '' });
  });
});

describe('ssbjNarrativeEntriesOfSection', () => {
  it('マスターの項目の順に並べ、文章の無い項目は未入力にする（欠落させない）', () => {
    const entries = ssbjNarrativeEntriesOfSection('governance', fictionalNarratives);
    expect(entries.map(entry => entry.itemId)).toEqual(ssbjNarrativeItemsOfSection('governance').map(item => item.id));
    expect(entries[0].text.disclosure.state).toBe('answered');
    expect(entries[1].text).toEqual(EMPTY_SSBJ_DISCLOSABLE_TEXT);
  });

  it('マスターに無い項目の文章は最後に足し、黙って落とさない', () => {
    const extra: SsbjNarrative = { itemId: 'governance.old_item', text: EMPTY_SSBJ_DISCLOSABLE_TEXT };
    const entries = ssbjNarrativeEntriesOfSection('governance', [...fictionalNarratives, extra]);
    expect(entries.at(-1)).toEqual({ itemId: 'governance.old_item', item: null, text: EMPTY_SSBJ_DISCLOSABLE_TEXT });
  });
});

describe('mergeSsbjNarrativeDrafts', () => {
  it('編集中の項目は保存済みの文章の代わりに編集中の内容を出し、ほかの項目はそのまま', () => {
    const draft: SsbjNarrative['text'] = { disclosure: { state: 'answered', value: '編集中の文章' }, internalNote: null };
    const merged = mergeSsbjNarrativeDrafts(fictionalNarratives, {
      'governance.oversight_body': draft,
      'governance.management_role': draft,
    });
    expect(merged.find(narrative => narrative.itemId === 'governance.oversight_body')?.text).toEqual(draft);
    expect(merged.find(narrative => narrative.itemId === 'governance.management_role')?.text).toEqual(draft);
    expect(merged.filter(narrative => narrative.itemId === 'governance.oversight_body')).toHaveLength(1);
    expect(merged).toHaveLength(fictionalNarratives.length + 1);
    expect(mergeSsbjNarrativeDrafts(fictionalNarratives, {})).toEqual(fictionalNarratives);
  });
});
