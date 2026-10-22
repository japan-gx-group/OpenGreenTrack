import { afterEach, describe, expect, it, vi } from 'vitest';

// 保存（更新して、無ければ作る）・一覧からの保存（2 列だけ、読込時の更新日時を条件にする）と
// DB 行 ⇔ 画面の型の変換を検証する（RLS・制約はマイグレーション側で確認する）。
const mocks = vi.hoisted(() => ({
  updateSelect: vi.fn(),
  updateMaybeSingle: vi.fn(),
  updateEq: vi.fn(),
  insertSingle: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      update: (columns: unknown) => {
        mocks.update(columns);
        const chain = {
          eq: (column: string, value: unknown) => {
            mocks.updateEq(column, value);
            return chain;
          },
          select: () => Object.assign(Promise.resolve(mocks.updateSelect()), { maybeSingle: mocks.updateMaybeSingle }),
        };
        return chain;
      },
      insert: (row: unknown) => {
        mocks.insert(row);
        return { select: () => ({ single: mocks.insertSingle }) };
      },
    }),
  }),
}));

import type { SsbjJudgement } from '../../types';
import { saveSsbjJudgement, saveSsbjJudgementQuickChange, toSsbjJudgement } from '../judgementService';
import { SsbjEditConflictError } from '../../utils/writeError';

const report = { id: 'report-1', organizationId: 'org-1' };
const judgement: SsbjJudgement = {
  requirementId: 'REQ-CLM-020',
  applicability: 'applicable',
  materiality: 'material',
  omissionReason: 'transition_relief',
  explanation: { disclosure: { state: 'answered', value: '経過措置を適用した。' }, internalNote: '整備中' },
};
const row = {
  requirementId: 'REQ-CLM-020',
  applicability: 'applicable',
  materiality: 'material',
  omissionReason: 'transition_relief',
  explanationState: 'answered',
  explanationText: '経過措置を適用した。',
  internalReason: '整備中',
};

afterEach(() => vi.clearAllMocks());

describe('toSsbjJudgement', () => {
  it('DB 行を判断に戻す', () => {
    expect(toSsbjJudgement(row)).toEqual(judgement);
  });

  it('区分の値が不正な行、状態と値が食い違う行は補正せず例外にする', () => {
    expect(() => toSsbjJudgement({ ...row, applicability: 'maybe' })).toThrow('該当性の値が不正です');
    expect(() => toSsbjJudgement({ ...row, explanationState: 'unconfirmed' })).toThrow();
  });
});

describe('saveSsbjJudgement', () => {
  it('行があれば更新だけで済ませる（作成後に変えない列は送らない）', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [row], error: null });
    await expect(saveSsbjJudgement(report, judgement)).resolves.toEqual(judgement);
    expect(mocks.update).toHaveBeenCalledWith({
      applicability: 'applicable',
      materiality: 'material',
      omissionReason: 'transition_relief',
      explanationState: 'answered',
      explanationText: '経過措置を適用した。',
      internalReason: '整備中',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('行が無ければ組織・レポート・要求を付けて作る', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.insertSingle.mockResolvedValue({ data: row, error: null });
    await saveSsbjJudgement(report, judgement);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'report-1', organizationId: 'org-1', requirementId: 'REQ-CLM-020',
    }));
  });

  it('同時に最初の判断が作られた（23505）ときは開き直しを促す', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.insertSingle.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });
    await expect(saveSsbjJudgement(report, judgement)).rejects.toThrow('画面を開き直して');
  });
});

describe('saveSsbjJudgementQuickChange', () => {
  const savedAt = '2025-06-01T00:00:00.123456+00:00';
  const savedRow = { ...row, updatedAt: '2025-06-02T00:00:00.000000+00:00' };

  it('行があれば、該当性・重要性の 2 列だけを、読込時の更新日時を条件に更新する（根拠を古い値に戻さない）', async () => {
    mocks.updateMaybeSingle.mockResolvedValue({ data: savedRow, error: null });
    await expect(saveSsbjJudgementQuickChange(report, savedAt, judgement))
      .resolves.toEqual({ ...judgement, updatedAt: savedRow.updatedAt });
    expect(mocks.update).toHaveBeenCalledWith({ applicability: 'applicable', materiality: 'material' });
    expect(mocks.updateEq).toHaveBeenCalledWith('updatedAt', savedAt);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('読込後に他の画面で保存されていれば（0 件更新）、競合にする', async () => {
    mocks.updateMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(saveSsbjJudgementQuickChange(report, savedAt, judgement)).rejects.toBeInstanceOf(SsbjEditConflictError);
  });

  it('行が無ければ作り、その間に他の画面が先に作っていれば（23505）上書きせずに競合にする', async () => {
    mocks.insertSingle.mockResolvedValue({ data: savedRow, error: null });
    await saveSsbjJudgementQuickChange(report, null, judgement);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'report-1', requirementId: 'REQ-CLM-020' }));

    mocks.insertSingle.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });
    await expect(saveSsbjJudgementQuickChange(report, null, judgement)).rejects.toBeInstanceOf(SsbjEditConflictError);
  });

  it('承認済みで止められたら、理由と次の手順を伝える', async () => {
    mocks.updateMaybeSingle.mockResolvedValue({ data: null, error: { code: 'P2051', message: 'locked' } });
    await expect(saveSsbjJudgementQuickChange(report, savedAt, judgement)).rejects.toThrow('承認済みのレポートは変更できません');
  });
});
