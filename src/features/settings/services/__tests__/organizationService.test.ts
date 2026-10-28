import { beforeEach, describe, expect, it, vi } from 'vitest';

// 企業情報の更新は RLS で管理者だけに絞られ、拒否はエラーではなく「0 行の更新」で返る。
// single() が返す 0 行のエラー（PGRST116）を、理由の分かるメッセージにしていることを確かめる。

const mocks = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as null | { code?: string; message: string } },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({ single: async () => mocks.result }),
        }),
      }),
    }),
  }),
}));

import { updateOrganization } from '../organizationService';

const input = {
  name: '株式会社テスト',
  corporateNumber: '',
  industrySector: '',
  address: '',
  envManagerName: '',
  fiscalYearStartMonth: 4,
};

describe('updateOrganization', () => {
  beforeEach(() => {
    mocks.result = { data: null, error: null };
  });

  it('RLS で 0 行になった（管理者でない）ときは「管理者のみ変更できます」', async () => {
    mocks.result = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    await expect(updateOrganization('org-1', input)).rejects.toThrow('企業情報は管理者のみ変更できます');
  });

  it('ほかのエラーは保存の失敗として伝える', async () => {
    mocks.result = { data: null, error: { code: '23514', message: 'check violation' } };
    await expect(updateOrganization('org-1', input)).rejects.toThrow('企業情報の保存に失敗しました');
  });

  it('更新できたら、画面用の形に直して返す', async () => {
    mocks.result = {
      data: {
        id: 'org-1',
        name: '株式会社テスト',
        corporateNumber: null,
        industrySector: null,
        address: null,
        envManagerName: null,
        fiscalYearStartMonth: 4,
      },
      error: null,
    };
    await expect(updateOrganization('org-1', input)).resolves.toMatchObject({
      id: 'org-1',
      corporateNumber: '',
      fiscalYearStartMonth: 4,
    });
  });
});
