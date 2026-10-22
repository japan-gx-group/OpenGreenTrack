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
const row = {
  itemId: 'governance.oversight_body', disclosureState: 'answered', disclosureText: '本文', internalNote: null, templateInput: null,
};
const templateInput = { version: 'r2-trial-1', choices: { body: 'board' }, texts: {} };

afterEach(() => vi.clearAllMocks());

describe('toSsbjNarrative', () => {
  it('状態と値が食い違う行は補正せず例外にする', () => {
    expect(() => toSsbjNarrative({ ...row, disclosureState: 'unconfirmed' })).toThrow();
  });

  it('選択式テンプレートの選択を読み、形の違う値は使わない（null）', () => {
    expect(toSsbjNarrative({ ...row, templateInput }).templateInput).toEqual(templateInput);
    expect(toSsbjNarrative({ ...row, templateInput: { version: 1 } }).templateInput).toBeNull();
    expect(toSsbjNarrative({ ...row, templateInput: ['board'] }).templateInput).toBeNull();
  });
});

describe('saveSsbjNarrative', () => {
  it('行があれば更新だけで済ませる（作成後に変えない列は送らない）', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [row], error: null });
    await expect(saveSsbjNarrative(report, 'governance.oversight_body', text)).resolves.toEqual({
      itemId: 'governance.oversight_body',
      text,
      templateInput: null,
    });
    expect(mocks.update).toHaveBeenCalledWith({
      disclosureState: 'answered', disclosureText: '本文', internalNote: null, templateInput: null,
    });
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

  it('選択式テンプレートの選択を本文と一緒に送る（本文の代わりにはしない）', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [{ ...row, templateInput }], error: null });
    const saved = await saveSsbjNarrative(report, 'governance.oversight_body', text, templateInput);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ disclosureText: '本文', templateInput }));
    expect(saved.templateInput).toEqual(templateInput);
  });

  it('同時に最初の文章が作られた（23505）ときは開き直しを促す', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    mocks.insertSingle.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });
    await expect(saveSsbjNarrative(report, 'governance.oversight_body', text)).rejects.toThrow('画面を開き直して');
  });
});
