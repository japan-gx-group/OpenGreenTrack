import type { SsbjEvidence, SsbjFieldState, SsbjItemId } from '../types';
import { isSsbjSha256 } from './fileHash';
import { isSsbjItemId } from './ids';

// 記録日時は DB が決める（利用者は書けない）ため、入力には含めない。
export type SsbjEvidenceInput = Omit<SsbjEvidence, 'id' | 'fileRecordedAt'>;
export type SsbjEvidenceFormValues = {
  itemId: string;
  documentTitle: string;
  documentVersion: string;
  internalLocation: string;
  referencePosition: string;
  ownerDepartment: string;
  /** ファイル名と SHA-256 は、画面でファイルを選んだときに一緒に入る（手では入力しない）。 */
  fileName: string;
  fileSha256: string;
  fileStorageVersionId: string;
  fileStoredBy: string;
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
  fileName: '',
  fileSha256: '',
  fileStorageVersionId: '',
  fileStoredBy: '',
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
  fileName: optional(values.fileName),
  fileSha256: optional(values.fileSha256.toLowerCase()),
  fileStorageVersionId: optional(values.fileStorageVersionId),
  fileStoredBy: optional(values.fileStoredBy),
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
  if ((input.fileName === null) !== (input.fileSha256 === null)) {
    errors.push('ファイル名と SHA-256 は、ファイルを選び直して一緒に記録してください');
  } else if (input.fileSha256 !== null && !isSsbjSha256(input.fileSha256)) {
    errors.push('SHA-256 の形式が正しくありません。ファイルを選び直してください');
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
  fileName: evidence.fileName ?? '',
  fileSha256: evidence.fileSha256 ?? '',
  fileStorageVersionId: evidence.fileStorageVersionId ?? '',
  fileStoredBy: evidence.fileStoredBy ?? '',
  disclosureState: evidence.disclosure.state,
  disclosureText: evidence.disclosure.state === 'answered' ? evidence.disclosure.value : '',
});
