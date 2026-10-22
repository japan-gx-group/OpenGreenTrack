// 根拠文書の作業中データ。組織分離とレポートの帰属はDBのRLSで検証する。
import { createClient } from '@/lib/supabase/client';
import type { SsbjEvidence, SsbjItemId } from '../types';
import { fromFieldValue, toFieldValue } from '../utils/fieldValue';
import type { SsbjEvidenceInput } from '../utils/evidence';
import { ssbjWriteErrorMessage } from '../utils/writeError';
import { throwIfSsbjEditForbidden } from './memberRoleService';

type SsbjEvidenceRow = {
  id: string;
  itemId: string;
  documentTitle: string;
  documentVersion: string | null;
  internalLocation: string | null;
  referencePosition: string | null;
  ownerDepartment: string | null;
  fileName: string | null;
  fileSha256: string | null;
  fileStorageVersionId: string | null;
  fileStoredBy: string | null;
  fileRecordedAt: string | null;
  disclosureState: string;
  disclosureText: string | null;
};

const SELECT_COLUMNS =
  'id, itemId, documentTitle, documentVersion, internalLocation, referencePosition, ownerDepartment, ' +
  'fileName, fileSha256, fileStorageVersionId, fileStoredBy, fileRecordedAt, disclosureState, disclosureText';

const toEvidence = (row: SsbjEvidenceRow): SsbjEvidence => ({
  id: row.id,
  itemId: row.itemId as SsbjItemId,
  documentTitle: row.documentTitle,
  documentVersion: row.documentVersion,
  internalLocation: row.internalLocation,
  referencePosition: row.referencePosition,
  ownerDepartment: row.ownerDepartment,
  fileName: row.fileName,
  fileSha256: row.fileSha256,
  fileStorageVersionId: row.fileStorageVersionId,
  fileStoredBy: row.fileStoredBy,
  fileRecordedAt: row.fileRecordedAt,
  disclosure: toFieldValue<string>(row.disclosureState, row.disclosureText),
});

const toColumns = (input: SsbjEvidenceInput) => {
  const disclosure = fromFieldValue(input.disclosure);
  return {
    itemId: input.itemId,
    documentTitle: input.documentTitle,
    documentVersion: input.documentVersion,
    internalLocation: input.internalLocation,
    referencePosition: input.referencePosition,
    ownerDepartment: input.ownerDepartment,
    fileName: input.fileName,
    fileSha256: input.fileSha256,
    fileStorageVersionId: input.fileStorageVersionId,
    fileStoredBy: input.fileStoredBy,
    disclosureState: disclosure.state,
    disclosureText: disclosure.value,
  };
};

export const listSsbjEvidence = async (reportId: string): Promise<SsbjEvidence[]> => {
  const { data, error } = await createClient().from('ssbj_evidence').select(SELECT_COLUMNS)
    .eq('reportId', reportId).order('itemId').order('createdAt').order('id');
  if (error) throw new Error('根拠文書の取得に失敗しました');
  return ((data ?? []) as unknown as SsbjEvidenceRow[]).map(toEvidence);
};

export const createSsbjEvidence = async (
  report: { id: string; organizationId: string }, input: SsbjEvidenceInput,
): Promise<SsbjEvidence> => {
  const { data, error } = await createClient().from('ssbj_evidence')
    .insert({ ...toColumns(input), organizationId: report.organizationId, reportId: report.id })
    .select(SELECT_COLUMNS).single();
  if (error || !data) throw new Error(ssbjWriteErrorMessage(error, '根拠文書の登録に失敗しました'));
  return toEvidence(data as unknown as SsbjEvidenceRow);
};

export const updateSsbjEvidence = async (id: string, input: SsbjEvidenceInput): Promise<SsbjEvidence> => {
  const { data, error } = await createClient().from('ssbj_evidence')
    .update(toColumns(input)).eq('id', id).select(SELECT_COLUMNS).maybeSingle();
  if (error) throw new Error(ssbjWriteErrorMessage(error, '根拠文書の更新に失敗しました'));
  if (!data) {
    // 0 件: ロールで止められた（RESTRICTIVE のポリシーは 0 件にする）か、削除済み。
    await throwIfSsbjEditForbidden();
    throw new Error('根拠文書が見つかりません。画面を開き直してください');
  }
  return toEvidence(data as unknown as SsbjEvidenceRow);
};

export const deleteSsbjEvidence = async (id: string): Promise<void> => {
  const { data, error } = await createClient().from('ssbj_evidence').delete().eq('id', id).select('id');
  if (error) throw new Error(ssbjWriteErrorMessage(error, '根拠文書の削除に失敗しました'));
  if (!data?.length) {
    // 0 件: ロールで止められた（RESTRICTIVE のポリシーは 0 件にする）か、削除済み。
    await throwIfSsbjEditForbidden();
    throw new Error('根拠文書が見つかりません。画面を開き直してください');
  }
};
