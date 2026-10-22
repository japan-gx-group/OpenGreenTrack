import { afterEach, describe, expect, it, vi } from 'vitest';

// 外部算定値の DB 行 ⇔ 画面の型の変換と、書き込みの失敗のメッセージを検証する（RLS・制約・重なりはマイグレーション側と DB で確認する）。
const mocks = vi.hoisted(() => ({
  single: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), update: vi.fn(), del: vi.fn(), delSelect: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: unknown) => { mocks.insert(row); return { select: () => ({ single: mocks.single }) }; },
      update: (row: unknown) => { mocks.update(row); return { eq: () => ({ select: () => ({ maybeSingle: mocks.maybeSingle }) }) }; },
      delete: () => ({ eq: (column: string, value: unknown) => { mocks.del(column, value); return { select: mocks.delSelect }; } }),
    }),
  }),
}));

import {
  createSsbjExternalEmission,
  deleteSsbjExternalEmission,
  externalEmissionErrorMessage,
  toSsbjExternalEmission,
  updateSsbjExternalEmission,
} from '../externalEmissionService';

const row = {
  id: 'e1', scope: 1, scope3CategoryId: null, scope2Basis: null, gases: ['CH4', 'N2O'], value: '1.250', unit: 't-CO2e',
  periodStart: '2024-04-01', periodEnd: '2025-03-31', calculatedBy: '架空', calculationMethod: '方法', evidenceId: 'ev1',
  confirmedByUserId: 'u1', confirmedAt: '2025-06-02T00:00:00+00:00', internalNote: null,
};
const input = {
  scope: 1 as const, scope3CategoryId: null, scope2Basis: null, gases: ['CH4' as const], value: '1.250',
  period: { startDate: '2024-04-01', endDate: '2025-03-31' }, calculatedBy: '架空', calculationMethod: '方法',
  evidenceId: 'ev1', confirmedByUserId: 'u1', confirmedAt: '2025-06-02T00:00:00+09:00', internalNote: null,
};

afterEach(() => vi.clearAllMocks());

describe('toSsbjExternalEmission', () => {
  it('期間をまとめ、排出量は文字列のまま受け取る', () => {
    expect(toSsbjExternalEmission(row)).toMatchObject({
      value: '1.250', unit: 't-CO2e', period: { startDate: '2024-04-01', endDate: '2025-03-31' }, gases: ['CH4', 'N2O'],
    });
  });
});

describe('createSsbjExternalEmission', () => {
  it('レポートと組織を付けて作り、排出量は十進の文字列のまま送る', async () => {
    mocks.single.mockResolvedValue({ data: row, error: null });
    await createSsbjExternalEmission({ id: 'report-1', organizationId: 'org-1' }, input);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'report-1', organizationId: 'org-1', value: '1.250', unit: 't-CO2e', periodStart: '2024-04-01',
    }));
  });

  it('二重計上（P2071 / P2072）は DB の理由をそのまま出す', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: 'P2071', message: 'この Scope・カテゴリの CO2 は、OGT の採用値に含まれています' } });
    await expect(createSsbjExternalEmission({ id: 'r', organizationId: 'o' }, input)).rejects.toThrow('OGT の採用値に含まれています');
  });
});

describe('externalEmissionErrorMessage', () => {
  it('承認済み・ロールで止められたときは、その理由を出す', () => {
    expect(externalEmissionErrorMessage({ code: 'P2051' }, '失敗')).toContain('承認済み');
    expect(externalEmissionErrorMessage({ code: '42501' }, '失敗')).toContain('入力担当か管理者だけ');
    expect(externalEmissionErrorMessage({ code: 'XX000', message: 'internal' }, '失敗')).toBe('失敗');
  });
});

describe('updateSsbjExternalEmission', () => {
  it('更新した行を返す', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: row, error: null });
    await expect(updateSsbjExternalEmission('e1', input)).resolves.toMatchObject({ id: 'e1', value: '1.250' });
  });

  it('0 件（他の画面で削除された・ロールが変わって RLS で止められた）なら、開き直しを案内する', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(updateSsbjExternalEmission('e1', input)).rejects.toThrow('画面を開き直してください');
  });
});

describe('deleteSsbjExternalEmission', () => {
  it('削除した行を返させ、1 件消えたら成功', async () => {
    mocks.delSelect.mockResolvedValue({ data: [{ id: 'e1' }], error: null });
    await expect(deleteSsbjExternalEmission('e1')).resolves.toBeUndefined();
    expect(mocks.del).toHaveBeenCalledWith('id', 'e1');
    expect(mocks.delSelect).toHaveBeenCalledWith('id');
  });

  it('0 件（RLS で止められた削除はエラーにならない）なら成功にせず、開き直しを案内する', async () => {
    mocks.delSelect.mockResolvedValue({ data: [], error: null });
    await expect(deleteSsbjExternalEmission('e1')).rejects.toThrow(
      '外部算定値を削除できませんでした（他の画面で削除されたか、SSBJ のロールが変わった可能性があります）。画面を開き直してください',
    );
  });

  it('承認済みなどで DB が拒否したときは、その理由を出す', async () => {
    mocks.delSelect.mockResolvedValue({ data: null, error: { code: 'P2051' } });
    await expect(deleteSsbjExternalEmission('e1')).rejects.toThrow('承認済み');
  });
});
