import { describe, expect, it } from 'vitest';
import { fictionalNarratives } from '../../__fixtures__/fictionalReport';
import type { SsbjNarrative } from '../../types';
import {
  EMPTY_SSBJ_DISCLOSABLE_TEXT,
  normalizeSsbjNarrativeInput,
  ssbjNarrativeEntriesOfSection,
  toSsbjNarrativeFormValues,
  validateSsbjNarrativeInput,
} from '../narrative';
import { ssbjNarrativeItemsOfSection } from '../requirementMaster';

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
