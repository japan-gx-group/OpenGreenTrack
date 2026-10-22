import { afterEach, describe, expect, it, vi } from 'vitest';

// 除外の記録（作るだけ）・採用して登録（RPC）・取り消しと、DB 行 ⇔ 画面の型の変換を検証する（RLS・制約はマイグレーション側で確認する）。
const mocks = vi.hoisted(() => ({
  insertSingle: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  deleteEq: vi.fn(),
  deleteSelect: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      update: mocks.update,
      insert: (row: unknown) => {
        mocks.insert(row);
        return { select: () => ({ single: mocks.insertSingle }) };
      },
      delete: () => {
        const filter = {
          eq: (column: string, value: unknown) => {
            mocks.deleteEq(column, value);
            return filter;
          },
          select: mocks.deleteSelect,
        };
        return filter;
      },
    }),
    rpc: mocks.rpc,
  }),
}));

import {
  adoptSsbjRiskCandidate,
  createSsbjRiskCandidateDecision,
  deleteSsbjRiskCandidateDecision,
  toSsbjRiskCandidateDecision,
} from '../riskCandidateService';

const report = { id: 'report-1', organizationId: 'org-1' };
const input = {
  candidateId: 'common.carbon_pricing', candidateVersion: 'r2-trial-1', industryCode: 'RT-IG',
  decision: 'adopted' as const, reason: null, riskOpportunityId: 'risk-1',
};
const row = { ...input, updatedAt: '2025-06-01T00:00:00.000Z' };
const excludedInput = {
  candidateId: 'common.carbon_pricing', candidateVersion: 'r2-trial-1', industryCode: 'RT-IG',
  decision: 'excluded' as const, reason: '炭素価格の対象となる排出が無いため', riskOpportunityId: null,
};
const excludedRow = { ...excludedInput, updatedAt: '2025-06-01T00:00:00.123456+00:00' };

afterEach(() => vi.clearAllMocks());

describe('toSsbjRiskCandidateDecision', () => {
  it('不明な判断の種類は補正せず例外にする', () => {
    expect(toSsbjRiskCandidateDecision(row)).toEqual(row);
    expect(() => toSsbjRiskCandidateDecision({ ...row, decision: 'maybe' })).toThrow();
  });
});

describe('createSsbjRiskCandidateDecision', () => {
  it('組織・レポート・候補を付けて判断の行を作り、既にある判断は更新しない', async () => {
    mocks.insertSingle.mockResolvedValue({ data: excludedRow, error: null });
    await expect(createSsbjRiskCandidateDecision(report, excludedInput)).resolves.toEqual(excludedRow);
    expect(mocks.insert).toHaveBeenCalledWith({ ...excludedInput, reportId: 'report-1', organizationId: 'org-1' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('他の画面で先に判断されていたら（一意制約）、上書きせずに開き直しを促す', async () => {
    // 古い画面からの除外で、他の画面の採用の関連付けを外さない（外すと再採用で同じリスク・機会が重複して登録される）。
    mocks.insertSingle.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(createSsbjRiskCandidateDecision(report, excludedInput)).rejects.toThrow('この候補は他の画面で先に判断されました');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('承認済みで止められたら、理由と次の手順を伝える', async () => {
    mocks.insertSingle.mockResolvedValue({ data: null, error: { code: 'P2051', message: 'locked' } });
    await expect(createSsbjRiskCandidateDecision(report, excludedInput)).rejects.toThrow('承認済みのレポートは変更できません');
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
    linkTargets: ['strategy.business_model_impact'], updatedAt: '2025-06-01T00:00:00.123456+00:00',
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
    expect(result.riskOpportunity).toMatchObject({
      id: 'risk-1', title: '炭素価格の導入', riskType: { state: 'answered', value: 'transition' },
      updatedAt: '2025-06-01T00:00:00.123456+00:00',
    });
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
  it('読み込んだ時点の判断の更新日時を条件にして削除し、失敗したら例外にする', async () => {
    mocks.deleteSelect.mockResolvedValue({ data: [{ candidateId: 'common.carbon_pricing' }], error: null });
    await expect(deleteSsbjRiskCandidateDecision('report-1', excludedRow)).resolves.toBeUndefined();
    expect(mocks.deleteEq.mock.calls).toEqual([
      ['reportId', 'report-1'],
      ['candidateId', 'common.carbon_pricing'],
      // 文字列のまま渡す（Date に変換するとマイクロ秒が落ちて一致しなくなる）。
      ['updatedAt', '2025-06-01T00:00:00.123456+00:00'],
    ]);
    mocks.deleteSelect.mockResolvedValue({ data: null, error: { code: '42501' } });
    await expect(deleteSsbjRiskCandidateDecision('report-1', excludedRow)).rejects.toThrow('取り消しに失敗しました');
  });

  it('他の画面で変わっていたか、登録したリスク・機会が残っていて RLS が削除させなかった（0 行）ら、開き直しを促す', async () => {
    mocks.deleteSelect.mockResolvedValue({ data: [], error: null });
    await expect(deleteSsbjRiskCandidateDecision('report-1', excludedRow)).rejects.toThrow('他の画面で変更されたため、未検討に戻していません');
  });
});
