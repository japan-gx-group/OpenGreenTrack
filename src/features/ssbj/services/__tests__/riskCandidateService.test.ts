import { afterEach, describe, expect, it, vi } from 'vitest';

// 保存（更新して、無ければ作る）・取り消しと、DB 行 ⇔ 画面の型の変換を検証する（RLS・制約はマイグレーション側で確認する）。
const mocks = vi.hoisted(() => ({
  updateSelect: vi.fn(),
  insertSingle: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  deleteResult: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      update: (columns: unknown) => {
        mocks.update(columns);
        return { eq: () => ({ eq: () => ({ select: mocks.updateSelect }) }) };
      },
      insert: (row: unknown) => {
        mocks.insert(row);
        return { select: () => ({ single: mocks.insertSingle }) };
      },
      delete: () => ({ eq: () => ({ eq: mocks.deleteResult }) }),
    }),
  }),
}));

import {
  deleteSsbjRiskCandidateDecision,
  saveSsbjRiskCandidateDecision,
  toSsbjRiskCandidateDecision,
} from '../riskCandidateService';

const report = { id: 'report-1', organizationId: 'org-1' };
const input = {
  candidateId: 'common.carbon_pricing', candidateVersion: 'r2-trial-1', industryCode: 'RT-IG',
  decision: 'adopted' as const, reason: null, riskOpportunityId: 'risk-1',
};
const row = { ...input, updatedAt: '2025-06-01T00:00:00.000Z' };

afterEach(() => vi.clearAllMocks());

describe('toSsbjRiskCandidateDecision', () => {
  it('不明な判断の種類は補正せず例外にする', () => {
    expect(toSsbjRiskCandidateDecision(row)).toEqual(row);
    expect(() => toSsbjRiskCandidateDecision({ ...row, decision: 'maybe' })).toThrow();
  });
});

describe('saveSsbjRiskCandidateDecision', () => {
  it('行があれば更新だけで済ませる（候補 ID・組織・レポートは送らない）', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [row], error: null });
    await expect(saveSsbjRiskCandidateDecision(report, input)).resolves.toEqual(row);
    expect(mocks.update).toHaveBeenCalledWith({
      candidateVersion: 'r2-trial-1', industryCode: 'RT-IG', decision: 'adopted', reason: null, riskOpportunityId: 'risk-1',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('行が無ければ組織・レポート・候補を付けて作る', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.insertSingle.mockResolvedValue({ data: row, error: null });
    await saveSsbjRiskCandidateDecision(report, input);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'report-1', organizationId: 'org-1', candidateId: 'common.carbon_pricing',
    }));
  });

  it('承認済みで止められたら、理由と次の手順を伝える', async () => {
    mocks.updateSelect.mockResolvedValue({ data: null, error: { code: 'P2051', message: 'locked' } });
    await expect(saveSsbjRiskCandidateDecision(report, input)).rejects.toThrow('承認済みのレポートは変更できません');
  });
});

describe('deleteSsbjRiskCandidateDecision', () => {
  it('失敗したら例外にする', async () => {
    mocks.deleteResult.mockResolvedValue({ error: null });
    await expect(deleteSsbjRiskCandidateDecision('report-1', 'common.carbon_pricing')).resolves.toBeUndefined();
    mocks.deleteResult.mockResolvedValue({ error: { code: '42501' } });
    await expect(deleteSsbjRiskCandidateDecision('report-1', 'common.carbon_pricing')).rejects.toThrow('取り消しに失敗しました');
  });
});
