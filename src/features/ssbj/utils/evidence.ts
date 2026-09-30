import type { SsbjEvidence, SsbjFieldState, SsbjItemId } from '../types';
import { isSsbjItemId } from './ids';

export type SsbjEvidenceInput = Omit<SsbjEvidence, 'id'>;
export type SsbjEvidenceFormValues = {
  itemId: string;
  documentTitle: string;
  documentVersion: string;
  internalLocation: string;
  referencePosition: string;
  ownerDepartment: string;
  disclosureState: SsbjFieldState;
  disclosureText: string;
};

export const EMPTY_SSBJ_EVIDENCE_FORM: SsbjEvidenceFormValues = {
  itemId: 'governance.',
  documentTitle: '',
  documentVersion: '',
  internalLocation: '',
  referencePosition: '',
  ownerDepartment: '',
  disclosureState: 'unanswered',
  disclosureText: '',
};

const optional = (value: string): string | null => value.trim() || null;

export const normalizeSsbjEvidenceInput = (values: SsbjEvidenceFormValues): SsbjEvidenceInput => ({
  itemId: values.itemId.trim() as SsbjItemId,
  documentTitle: values.documentTitle.trim(),
  documentVersion: optional(values.documentVersion),
  internalLocation: optional(values.internalLocation),
  referencePosition: optional(values.referencePosition),
  ownerDepartment: optional(values.ownerDepartment),
  disclosure: values.disclosureState === 'answered'
    ? { state: 'answered', value: values.disclosureText.trim() }
    : { state: values.disclosureState },
});

export const validateSsbjEvidenceInput = (input: SsbjEvidenceInput): string[] => {
  const errors: string[] = [];
  if (!isSsbjItemId(input.itemId)) errors.push('項目IDの形式が正しくありません');
  if (!input.documentTitle) errors.push('資料名を入力してください');
  if (input.disclosure.state === 'answered' && !input.disclosure.value) {
    errors.push('開示用参照文を入力してください');
  }
  return errors;
};

export const toSsbjEvidenceFormValues = (evidence: SsbjEvidence): SsbjEvidenceFormValues => ({
  itemId: evidence.itemId,
  documentTitle: evidence.documentTitle,
  documentVersion: evidence.documentVersion ?? '',
  internalLocation: evidence.internalLocation ?? '',
  referencePosition: evidence.referencePosition ?? '',
  ownerDepartment: evidence.ownerDepartment ?? '',
  disclosureState: evidence.disclosure.state,
  disclosureText: evidence.disclosure.state === 'answered' ? evidence.disclosure.value : '',
});
