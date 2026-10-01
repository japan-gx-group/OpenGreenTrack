import { describe, expect, it } from 'vitest';
import { fictionalJudgements } from '../../__fixtures__/fictionalReport';
import type { SsbjJudgement } from '../../types';
import {
  emptySsbjJudgement,
  isSsbjJudgementPending,
  isSsbjJudgementRecorded,
  isSsbjOmissionStatementMissing,
  normalizeSsbjJudgementInput,
  ssbjJudgementEntries,
  toSsbjJudgementFormValues,
  validateSsbjJudgementInput,
  type SsbjJudgementFormValues,
} from '../judgement';
import { SSBJ_REQUIREMENTS } from '../requirementMaster';

const values = (overrides: Partial<SsbjJudgementFormValues> = {}): SsbjJudgementFormValues => ({
  ...toSsbjJudgementFormValues(emptySsbjJudgement('REQ-CLM-020')),
  ...overrides,
});

describe('入力の正規化と検証', () => {
  it('入力済みのときだけ説明の本文を残し、前後の空白を落とし、空の内部理由は null にする', () => {
    expect(normalizeSsbjJudgementInput('REQ-CLM-020', values({
      explanationState: 'answered', explanationText: ' 経過措置を適用した。 ', internalReason: '  ',
    })).explanation).toEqual({ disclosure: { state: 'answered', value: '経過措置を適用した。' }, internalNote: null });
    expect(normalizeSsbjJudgementInput('REQ-CLM-020', values({
      explanationState: 'unconfirmed', explanationText: '下書き', internalReason: '確認中',
    })).explanation).toEqual({ disclosure: { state: 'unconfirmed' }, internalNote: '確認中' });
  });

  it('既定のまま（すべて未確認）は検証を通る（判断を強制しない）', () => {
    expect(validateSsbjJudgementInput(emptySsbjJudgement('REQ-CLM-020'))).toEqual([]);
  });

  it('「重要性がない」を理由にするなら、重要性は「重要性なし」でなければならない', () => {
    const judgement = normalizeSsbjJudgementInput('REQ-CLM-020', values({ omissionReason: 'not_material', materiality: 'material' }));
    expect(validateSsbjJudgementInput(judgement).join()).toContain('重要性を「重要性なし」にしてください');
    expect(validateSsbjJudgementInput({ ...judgement, materiality: 'not_material' })).toEqual([]);
  });

  it('「その他」「商業上の機密」で記載しないなら、内部の検討理由が要る', () => {
    for (const omissionReason of ['other', 'commercial_sensitivity'] as const) {
      const judgement = normalizeSsbjJudgementInput('REQ-GEN-004', values({ omissionReason }));
      expect(validateSsbjJudgementInput(judgement).join(), omissionReason).toContain('内部の検討理由を書いてください');
      const withReason = normalizeSsbjJudgementInput('REQ-GEN-004', values({ omissionReason, internalReason: '検討した' }));
      expect(validateSsbjJudgementInput(withReason), omissionReason).toEqual([]);
    }
  });

  it('入力済みなのに説明が空、マスターに無い要求はエラー', () => {
    const empty = normalizeSsbjJudgementInput('REQ-CLM-020', values({ explanationState: 'answered', explanationText: ' ' }));
    expect(validateSsbjJudgementInput(empty).join()).toContain('開示する説明を入力してください');
    expect(validateSsbjJudgementInput(emptySsbjJudgement('REQ-CLM-999'))).toContain('要求項目マスターに無い要求です');
  });

  it('保存済みの判断からフォームへ戻し、正規化すると元に戻る', () => {
    for (const judgement of fictionalJudgements) {
      expect(normalizeSsbjJudgementInput(judgement.requirementId, toSsbjJudgementFormValues(judgement))).toEqual(judgement);
    }
  });
});

describe('判断の状態', () => {
  it('該当性が未確認、または該当なのに重要性が未確認なら判断が済んでいない（非該当は重要性の判断不要）', () => {
    const base = emptySsbjJudgement('REQ-CLM-020');
    expect(isSsbjJudgementPending(base)).toBe(true);
    expect(isSsbjJudgementPending({ ...base, applicability: 'applicable' })).toBe(true);
    expect(isSsbjJudgementPending({ ...base, applicability: 'applicable', materiality: 'material' })).toBe(false);
    expect(isSsbjJudgementPending({ ...base, applicability: 'not_applicable' })).toBe(false);
  });

  it('既定のままなら記録なし、どれか 1 つでも変えれば記録あり', () => {
    const base = emptySsbjJudgement('REQ-CLM-020');
    expect(isSsbjJudgementRecorded(base)).toBe(false);
    expect(isSsbjJudgementRecorded({ ...base, explanation: { ...base.explanation, internalNote: 'メモ' } })).toBe(true);
  });

  it('経過措置・商業上の機密で記載しないのに説明が入力済みでなければ知らせる', () => {
    const base: SsbjJudgement = { ...emptySsbjJudgement('REQ-CLM-020'), omissionReason: 'transition_relief' };
    expect(isSsbjOmissionStatementMissing(base)).toBe(true);
    expect(isSsbjOmissionStatementMissing({
      ...base, explanation: { disclosure: { state: 'answered', value: '経過措置を適用した。' }, internalNote: null },
    })).toBe(false);
    expect(isSsbjOmissionStatementMissing({ ...base, omissionReason: 'not_material', materiality: 'not_material' })).toBe(false);
  });
});

describe('ssbjJudgementEntries', () => {
  it('マスターの全要求をマスターの順に並べ、判断の無い要求は未確認にする（欠落させない）', () => {
    const entries = ssbjJudgementEntries(fictionalJudgements);
    expect(entries.map(entry => entry.judgement.requirementId)).toEqual(SSBJ_REQUIREMENTS.map(requirement => requirement.id));
    expect(entries.find(entry => entry.judgement.requirementId === 'REQ-CLM-020')?.judgement.omissionReason)
      .toBe('transition_relief');
    expect(entries.find(entry => entry.judgement.requirementId === 'REQ-GEN-002')?.judgement)
      .toEqual(emptySsbjJudgement('REQ-GEN-002'));
  });

  it('マスターに無い要求の判断は最後に足し、黙って落とさない', () => {
    const extra = emptySsbjJudgement('REQ-CLM-999');
    const entries = ssbjJudgementEntries([...fictionalJudgements, extra]);
    expect(entries.at(-1)).toEqual({ requirement: null, judgement: extra });
  });
});
