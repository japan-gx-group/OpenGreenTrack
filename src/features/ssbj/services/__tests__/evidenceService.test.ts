// 根拠文書の更新・削除が 0 件だったときの扱いを検証する（RLS・制約はマイグレーション側とローカル DB で確かめる）。
// RLS の RESTRICTIVE のポリシーで止められた更新・削除はエラーにならず 0 件になるので、成功にも「見つかりません」にもせず、
// ロールで止められたのなら権限のメッセージにする。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fictionalEvidence } from '../../__fixtures__/fictionalReport';
import { normalizeSsbjEvidenceInput, toSsbjEvidenceFormValues } from '../../utils/evidence';
import { SSBJ_FORBIDDEN_MESSAGE } from '../../utils/writeError';

const mocks = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown }, canEdit: true }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const builder = {
        update: () => builder,
        delete: () => builder,
        eq: () => builder,
        select: () => builder,
        maybeSingle: async () => mocks.result,
        // delete().eq().select() の結果（await したとき）。
        then: (resolve: (value: unknown) => unknown) => resolve(mocks.result),
      };
      return builder;
    },
    rpc: async () => ({ data: mocks.canEdit, error: null }),
  }),
}));

import { deleteSsbjEvidence, updateSsbjEvidence } from '../evidenceService';

const [evidence] = fictionalEvidence;
const input = normalizeSsbjEvidenceInput(toSsbjEvidenceFormValues(evidence));

beforeEach(() => {
  mocks.canEdit = true;
});

describe('updateSsbjEvidence', () => {
  it('0 件で、ロールが変わって編集できなくなっていたら権限のメッセージにする', async () => {
    mocks.result = { data: null, error: null };
    mocks.canEdit = false;
    await expect(updateSsbjEvidence(evidence.id, input)).rejects.toThrow(SSBJ_FORBIDDEN_MESSAGE);
  });

  it('0 件で、編集はできるなら（削除済み）開き直しを促す', async () => {
    mocks.result = { data: null, error: null };
    await expect(updateSsbjEvidence(evidence.id, input)).rejects.toThrow('根拠文書が見つかりません。画面を開き直してください');
  });
});

describe('deleteSsbjEvidence', () => {
  it('削除できたら何も返さない', async () => {
    mocks.result = { data: [{ id: evidence.id }], error: null };
    await expect(deleteSsbjEvidence(evidence.id)).resolves.toBeUndefined();
  });

  it('0 件で、ロールが変わって編集できなくなっていたら権限のメッセージにする', async () => {
    mocks.result = { data: [], error: null };
    mocks.canEdit = false;
    await expect(deleteSsbjEvidence(evidence.id)).rejects.toThrow(SSBJ_FORBIDDEN_MESSAGE);
  });

  it('0 件で、編集はできるなら（削除済み）開き直しを促す', async () => {
    mocks.result = { data: [], error: null };
    await expect(deleteSsbjEvidence(evidence.id)).rejects.toThrow('根拠文書が見つかりません。画面を開き直してください');
  });
});
