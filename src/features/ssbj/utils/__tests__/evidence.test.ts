import { describe, expect, it } from 'vitest';
import { fictionalEvidence } from '../../__fixtures__/fictionalReport';
import {
  EMPTY_SSBJ_EVIDENCE_FORM, normalizeSsbjEvidenceInput, toSsbjEvidenceFormValues, validateSsbjEvidenceInput,
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

  it('ファイルの記録は、ファイル名と SHA-256 がそろったときだけ通し、SHA-256 は小文字にそろえる', () => {
    const values = { ...EMPTY_SSBJ_EVIDENCE_FORM, itemId: 'strategy.plan', documentTitle: '計画書' };
    const sha256 = 'AB'.repeat(32);
    const recorded = normalizeSsbjEvidenceInput({
      ...values, fileName: '計画書.pdf', fileSha256: sha256, fileStorageVersionId: ' 2.1 ', fileStoredBy: ' ',
    });
    expect(recorded).toMatchObject({
      fileName: '計画書.pdf', fileSha256: 'ab'.repeat(32), fileStorageVersionId: '2.1', fileStoredBy: null,
    });
    expect(validateSsbjEvidenceInput(recorded)).toEqual([]);
    expect(normalizeSsbjEvidenceInput(values)).toMatchObject({ fileName: null, fileSha256: null });
    expect(validateSsbjEvidenceInput({ ...recorded, fileName: null })).not.toEqual([]);
    expect(validateSsbjEvidenceInput({ ...recorded, fileSha256: null })).not.toEqual([]);
    expect(validateSsbjEvidenceInput({ ...recorded, fileSha256: 'ab'.repeat(31) })).not.toEqual([]);
  });

  it('保存済みのファイルの記録をフォームに戻し、記録日時は入力に含めない', () => {
    const values = toSsbjEvidenceFormValues(fictionalEvidence[0]);
    expect(values).toMatchObject({
      fileName: fictionalEvidence[0].fileName, fileSha256: fictionalEvidence[0].fileSha256,
      fileStorageVersionId: '3.0', fileStoredBy: '総務部 担当（架空）',
    });
    expect(normalizeSsbjEvidenceInput(values)).not.toHaveProperty('fileRecordedAt');
    expect(toSsbjEvidenceFormValues(fictionalEvidence[1])).toMatchObject({ fileName: '', fileSha256: '' });
  });
});
