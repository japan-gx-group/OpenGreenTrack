import { afterEach, describe, expect, it, vi } from 'vitest';

// 保存（更新して、無ければ作る）と DB 行 ⇔ 画面の型の変換を検証する（RLS・制約はマイグレーション側で確認する）。
const mocks = vi.hoisted(() => ({
  updateSelect: vi.fn(),
  insertSingle: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
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
    }),
  }),
}));

import { saveSsbjNarrative, toSsbjNarrative } from '../narrativeService';

const report = { id: 'report-1', organizationId: 'org-1' };
const text = { disclosure: { state: 'answered' as const, value: '本文' }, internalNote: null };
const row = { itemId: 'governance.oversight_body', disclosureState: 'answered', disclosureText: '本文', internalNote: null };

afterEach(() => vi.clearAllMocks());

describe('toSsbjNarrative', () => {
  it('状態と値が食い違う行は補正せず例外にする', () => {
    expect(() => toSsbjNarrative({ ...row, disclosureState: 'unconfirmed' })).toThrow();
  });
});

describe('saveSsbjNarrative', () => {
  it('行があれば更新だけで済ませる（作成後に変えない列は送らない）', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [row], error: null });
    await expect(saveSsbjNarrative(report, 'governance.oversight_body', text)).resolves.toEqual({
      itemId: 'governance.oversight_body',
      text,
    });
    expect(mocks.update).toHaveBeenCalledWith({ disclosureState: 'answered', disclosureText: '本文', internalNote: null });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('行が無ければ組織・レポート・項目を付けて作る', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.insertSingle.mockResolvedValue({ data: row, error: null });
    await saveSsbjNarrative(report, 'governance.oversight_body', text);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'report-1', organizationId: 'org-1', itemId: 'governance.oversight_body',
    }));
  });

  it('同時に最初の文章が作られた（23505）ときは開き直しを促す', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.insertSingle.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });
    await expect(saveSsbjNarrative(report, 'governance.oversight_body', text)).rejects.toThrow('画面を開き直して');
  });
});
