import { afterEach, describe, expect, it, vi } from 'vitest';

// 保存（更新して、無ければ作る）・採用して登録（RPC）・取り消しと、DB 行 ⇔ 画面の型の変換を検証する（RLS・制約はマイグレーション側で確認する）。
const mocks = vi.hoisted(() => ({
  updateSelect: vi.fn(),
  insertSingle: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  deleteResult: vi.fn(),
  rpc: vi.fn(),
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
    rpc: mocks.rpc,
  }),
}));

import {
  adoptSsbjRiskCandidate,
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

describe('adoptSsbjRiskCandidate', () => {
  const riskInput = {
    kind: 'risk' as const,
    title: '炭素価格の導入',
    riskType: { state: 'answered' as const, value: 'transition' as const },
    description: { disclosure: { state: 'unanswered' as const }, internalNote: null },
    timeHorizon: { state: 'unanswered' as const },
    linkTargets: ['strategy.business_model_impact' as const],
  };
  const riskRow = {
    id: 'risk-1', kind: 'risk', title: '炭素価格の導入', riskTypeState: 'answered', riskType: 'transition',
    descriptionState: 'unanswered', descriptionText: null, internalNote: null, timeHorizonState: 'unanswered', timeHorizon: null,
    linkTargets: ['strategy.business_model_impact'],
  };
  const candidate = { candidateId: 'common.carbon_pricing', candidateVersion: 'r2-trial-1' };

  it('登録と採用の記録を 1 回の RPC で送り（業種は送らない）、両方を画面の型にして返す', async () => {
    mocks.rpc.mockResolvedValue({ data: { riskOpportunity: riskRow, decision: row }, error: null });
    const result = await adoptSsbjRiskCandidate('report-1', candidate, riskInput);
    expect(mocks.rpc).toHaveBeenCalledWith('adopt_ssbj_risk_candidate', {
      p_report_id: 'report-1',
      p_candidate_id: 'common.carbon_pricing',
      p_candidate_version: 'r2-trial-1',
      p_risk: expect.objectContaining({ kind: 'risk', title: '炭素価格の導入', riskTypeState: 'answered', riskType: 'transition' }),
    });
    expect(result.riskOpportunity).toMatchObject({ id: 'risk-1', title: '炭素価格の導入', riskType: { state: 'answered', value: 'transition' } });
    expect(result.decision).toEqual(row);
  });

  it('同じ候補が先に採用されていたら（P2062）、開き直しを促す', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P2062', message: 'conflict' } });
    await expect(adoptSsbjRiskCandidate('report-1', candidate, riskInput)).rejects.toThrow('他の画面で先に採用されました');
  });

  it('承認済みで止められたら理由を、それ以外の失敗はリスク・機会も登録していないことを伝える', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P2051', message: 'locked' } });
    await expect(adoptSsbjRiskCandidate('report-1', candidate, riskInput)).rejects.toThrow('承認済みのレポートは変更できません');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(adoptSsbjRiskCandidate('report-1', candidate, riskInput)).rejects.toThrow('リスク・機会も登録していません');
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
