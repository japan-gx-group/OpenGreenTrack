import { describe, expect, it } from 'vitest';
import {
  EMPTY_SSBJ_EVIDENCE_FORM, normalizeSsbjEvidenceInput, validateSsbjEvidenceInput,
} from '../evidence';

describe('根拠文書の入力', () => {
  it('項目IDと資料名を必須とし、主管部署などは任意にする', () => {
    const input = normalizeSsbjEvidenceInput({
      ...EMPTY_SSBJ_EVIDENCE_FORM,
      itemId: 'governance.oversight_body',
      documentTitle: ' 取締役会議事録 ',
      ownerDepartment: '  ',
    });
    expect(validateSsbjEvidenceInput(input)).toEqual([]);
    expect(input.documentTitle).toBe('取締役会議事録');
    expect(input.ownerDepartment).toBeNull();
    expect(validateSsbjEvidenceInput(normalizeSsbjEvidenceInput({ ...EMPTY_SSBJ_EVIDENCE_FORM, itemId: 'governance', documentTitle: '資料' }))).not.toEqual([]);
    expect(validateSsbjEvidenceInput({ ...input, documentTitle: '' })).not.toEqual([]);
  });

  it('開示文が回答済みのときだけ値を残し、空白のみは拒否する', () => {
    const values = { ...EMPTY_SSBJ_EVIDENCE_FORM, itemId: 'strategy.plan', documentTitle: '計画書' };
    const answered = normalizeSsbjEvidenceInput({ ...values, disclosureState: 'answered', disclosureText: ' 参照文 ' });
    expect(answered.disclosure).toEqual({ state: 'answered', value: '参照文' });
    expect(validateSsbjEvidenceInput(answered)).toEqual([]);
    expect(validateSsbjEvidenceInput({ ...answered, disclosure: { state: 'answered', value: '' } })).not.toEqual([]);
    expect(normalizeSsbjEvidenceInput({ ...values, disclosureState: 'unconfirmed', disclosureText: '下書き' }).disclosure)
      .toEqual({ state: 'unconfirmed' });
  });
});
