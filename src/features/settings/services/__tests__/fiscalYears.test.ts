import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addFiscalYear } from '../fiscalYears';

// createAdminClient は環境変数が無いと throw するため、DB アクセスはモックへ差し替える。
// getCurrentProfile も Cookie セッションを読むのでモックにする。
const { createAdminClientMock, getCurrentProfileMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  getCurrentProfileMock: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }));
vi.mock('@/lib/currentProfile', () => ({ getCurrentProfile: getCurrentProfileMock }));

const ORGANIZATION_ID = 'org-1';

type FiscalYearRow = { id: string; label: string; startDate: string; endDate: string };

// addFiscalYear が使う 3 つのクエリ形だけを再現する:
//   organizations: .select().eq().single()
//   fiscal_years : .select().eq()（await でそのまま解決する）
//   fiscal_years : .insert().select().single()
const buildAdmin = (fiscalYearStartMonth: number, existing: FiscalYearRow[]) => {
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from: (table: string) => {
      if (table === 'organizations') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { fiscalYearStartMonth }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: existing, error: null }),
        }),
        insert: (payload: Record<string, unknown>) => {
          inserted.push(payload);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'fy-new', ...payload }, error: null }),
            }),
          };
        },
      };
    },
  };
  return { admin, inserted };
};

const setup = (fiscalYearStartMonth: number, existing: FiscalYearRow[]) => {
  const { admin, inserted } = buildAdmin(fiscalYearStartMonth, existing);
  createAdminClientMock.mockReturnValue(admin);
  return inserted;
};

const APRIL_2026: FiscalYearRow = {
  id: 'fy-2026',
  label: '2026年度',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
};

describe('addFiscalYear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentProfileMock.mockResolvedValue({ organizationId: ORGANIZATION_ID });
  });

  it('重ならない年度は追加できる', async () => {
    const inserted = setup(4, [APRIL_2026]);

    const result = await addFiscalYear({ startYear: 2027 });

    expect(result.ok).toBe(true);
    expect(inserted).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        label: '2027年度',
        startDate: '2027-04-01',
        endDate: '2028-03-31',
      },
    ]);
  });

  it('同じ開始年の年度は追加できない', async () => {
    const inserted = setup(7, [APRIL_2026]);

    const result = await addFiscalYear({ startYear: 2026 });

    expect(result).toMatchObject({ ok: false });
    expect(inserted).toHaveLength(0);
  });

  // 期首月を 4月→1月 に変えて翌年度を足すと 1〜3月が両方の年度に入る。
  // 重なった月の活動量は両年度の集計に計上され、年度合計が静かに二重計上になるため弾く。
  it('開始年もラベルも違うが期間が部分的に重なる年度は追加できない', async () => {
    const inserted = setup(1, [APRIL_2026]);

    const result = await addFiscalYear({ startYear: 2027 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('期間が重なります');
    expect(result.ok === false && result.error).toContain('2026年度: 2026/04 - 2027/03');
    expect(inserted).toHaveLength(0);
  });

  // 期首月を 1月→4月 に戻した場合は、追加する年度の側が先に始まる向きで重なる。
  it('追加する年度が既存年度より前から始まる向きの重なりも弾く', async () => {
    const inserted = setup(4, [
      { id: 'fy-2027', label: '2027年度', startDate: '2027-01-01', endDate: '2027-12-31' },
    ]);

    const result = await addFiscalYear({ startYear: 2026 });

    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  // 隣り合う年度（前年度の末日と当年度の初日）は重なりではない。
  it('前年度の翌日から始まる年度は重なり扱いにしない', async () => {
    const inserted = setup(4, [APRIL_2026]);

    const result = await addFiscalYear({ startYear: 2025 });

    expect(result.ok).toBe(true);
    expect(inserted[0]).toMatchObject({ startDate: '2025-04-01', endDate: '2026-03-31' });
  });
});
