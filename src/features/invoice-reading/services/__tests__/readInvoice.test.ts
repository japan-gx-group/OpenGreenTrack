import { beforeEach, describe, expect, it, vi } from 'vitest';

type Filter = { method: string; args: unknown[] };

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  locations: [] as Array<{ id: string; name: string; address: string | null }>,
  factors: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ table: string; filters: Filter[] }>,
  locationError: null as null | { message: string },
}));

vi.mock('@/lib/ai/generate', () => ({ generateStructured: mocks.generate }));
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => ({ warn: vi.fn(), error: vi.fn(), child: () => ({ warn: vi.fn(), error: vi.fn() }) }),
}));

// PostgREST のクエリビルダの代わり。呼ばれた絞り込みを記録し、係数は eq / in / is / not の条件で絞って返す。
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: Filter[] = [];
      mocks.queries.push({ table, filters });
      const matches = (row: Record<string, unknown>) =>
        filters.every(({ method, args }) => {
          const [column, value] = args as [string, unknown];
          if (method === 'eq') return row[column] === value;
          if (method === 'in') return (value as unknown[]).includes(row[column]);
          if (method === 'is') return row[column] === null;
          if (method === 'not') return row[column] !== null;
          return true;
        });
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'not', 'order']) {
        builder[method] = (...args: unknown[]) => {
          if (method !== 'select' && method !== 'order') filters.push({ method, args });
          return builder;
        };
      }
      builder.range = async () => ({ data: mocks.factors.filter(matches), error: null });
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: mocks.locationError ? null : mocks.locations, error: mocks.locationError });
      return builder;
    },
  }),
}));

import { readInvoice } from '../readInvoice';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const EVIDENCE = {
  id: 'file-1',
  fileName: '9月分.pdf',
  mimeType: 'application/pdf' as const,
  sizeBytes: 6,
  convertedFrom: null,
  storagePath: 'org-1/activity-evidence/file-1.pdf',
  createdAt: '2026-10-26T00:00:00Z',
  uploadedBy: 'user-1',
};
const profile = { id: 'user-1', organizationId: 'org-1' };

const factor = (overrides: Record<string, unknown>) => ({
  id: String(overrides.menuName ?? overrides.name),
  organizationId: null,
  name: '電気 東京電力エナジーパートナー(株) メニューL(残差)',
  energyType: 'electricity',
  scope: 'scope2',
  factorValue: '0.000452',
  unit: 't-CO2/kWh',
  applicableYear: 2025,
  regionName: '全国',
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: '2025-04-01',
  effectiveTo: '2026-03-31',
  providerName: '東京電力エナジーパートナー(株)',
  providerNumber: 'A0269',
  menuName: 'メニューL(残差)',
  factorType: 'adjusted',
  ...overrides,
});

const extraction = {
  kind: 'electricity',
  supplierName: '東京電力エナジーパートナー株式会社',
  supplierRegistrationNumber: 'A0269',
  supplyAddress: '東京都架空区架空町1丁目1番1号',
  items: [
    {
      kind: 'electricity',
      planName: 'スタンダードS',
      fuelName: null,
      usageMonth: '2025-09',
      periodStart: null,
      periodEnd: null,
      amount: 12345,
      unit: 'kWh',
    },
  ],
  warnings: [],
};

describe('readInvoice', () => {
  beforeEach(() => {
    mocks.generate.mockReset();
    mocks.queries = [];
    mocks.locationError = null;
    mocks.locations = [{ id: 'tokyo', name: '東京本社', address: '東京都架空区架空町1-1-1' }];
    mocks.factors = [factor({}), factor({ menuName: 'メニューA', name: '電気 東京電力エナジーパートナー(株) メニューA' })];
  });

  it('読取り → 候補（登録番号で絞る）→ 判定 の順に呼び、明細とフォームに入れる値を返す', async () => {
    mocks.generate
      .mockResolvedValueOnce({ ok: true, value: extraction, provider: 'google', modelId: 'gemini-3.5-flash' })
      .mockImplementationOnce(async (args: { validate: (value: unknown) => unknown }) => ({
        ok: true,
        value: args.validate({ items: [{ index: 1, key: 'p1-m1', reason: '残差を選んだ' }] }),
        provider: 'google',
        modelId: 'gemini-3.5-flash',
      }));

    const result = await readInvoice({ profile, file: PDF, evidence: EVIDENCE });

    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ purpose: 'invoice_reading', profile, input: [{ type: 'pdf', data: PDF }] });
    const matching = mocks.generate.mock.calls[1][0];
    expect(matching).toMatchObject({ purpose: 'invoice_factor_matching', input: [{ type: 'text' }] });
    // 送る文は読み取った値と候補だけ（拠点の名前・住所の一覧は送らない）
    expect(matching.input[0].text).toContain('p1: 東京電力エナジーパートナー(株)（登録番号 A0269）');
    expect(matching.input[0].text).not.toContain('東京本社');
    // 登録番号が分かれば、その事業者の行だけを読む
    const factorQuery = mocks.queries.find((query) => query.table === 'emission_factors');
    expect(factorQuery?.filters).toContainEqual({ method: 'eq', args: ['providerNumber', 'A0269'] });
    expect(factorQuery?.filters).toContainEqual({ method: 'eq', args: ['status', 'active'] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toMatchObject({
      evidence: EVIDENCE,
      provider: 'google',
      modelId: 'gemini-3.5-flash',
      supplierName: '東京電力エナジーパートナー株式会社',
    });
    expect(result.result.items[0].prefill?.evidenceFiles).toEqual([EVIDENCE]);
    expect(result.result.items[0]).toMatchObject({
      energyType: 'electricity',
      location: { id: 'tokyo', name: '東京本社' },
      factor: { status: 'matched' },
      prefill: { locationId: 'tokyo', targetMonth: '2025-09', amount: '12345' },
    });
  });

  it('読取りに失敗したら、その分類と文をそのまま返す（判定は呼ばない）', async () => {
    mocks.generate.mockResolvedValueOnce({ ok: false, code: 'limit_exceeded', message: '上限です', retryAfterSeconds: 30 });
    const result = await readInvoice({ profile, file: PDF, evidence: EVIDENCE });
    expect(result).toEqual({ ok: false, code: 'limit_exceeded', message: '上限です', retryAfterSeconds: 30 });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it('判定に失敗しても、読み取った使用量は返す（係数は人が選ぶ）', async () => {
    mocks.generate
      .mockResolvedValueOnce({ ok: true, value: extraction, provider: 'google', modelId: 'm' })
      .mockResolvedValueOnce({ ok: false, code: 'timeout', message: '時間内に応答がありませんでした' });
    const result = await readInvoice({ profile, file: PDF, evidence: EVIDENCE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.items[0].factor).toEqual({
      status: 'unavailable',
      reason: '排出係数を判定できませんでした（時間内に応答がありませんでした）。フォームで選んでください',
    });
    expect(result.result.items[0].prefill).toMatchObject({ amount: '12345', factor: null });
  });

  it('対象年度の係数が無い明細は、判定の AI を呼ばない', async () => {
    mocks.factors = [];
    mocks.generate.mockResolvedValueOnce({ ok: true, value: extraction, provider: 'google', modelId: 'm' });
    const result = await readInvoice({ profile, file: PDF, evidence: EVIDENCE });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(result.ok && result.result.items[0].factor.status).toBe('unavailable');
  });

  it('拠点の読み込みに失敗したら、決まった文を返す', async () => {
    mocks.locationError = { message: 'boom' };
    mocks.generate.mockResolvedValueOnce({ ok: true, value: extraction, provider: 'google', modelId: 'm' });
    const result = await readInvoice({ profile, file: PDF, evidence: EVIDENCE });
    expect(result).toEqual({
      ok: false,
      code: 'load_failed',
      message: '排出係数・拠点の読み込みに失敗しました。時間をおいて再度お試しください',
    });
  });

  it('画像は image として送る', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mocks.generate.mockResolvedValueOnce({ ok: false, code: 'timeout', message: 'x' });
    await readInvoice({ profile, file: png, evidence: EVIDENCE });
    expect(mocks.generate.mock.calls[0][0].input).toEqual([{ type: 'image', data: png }]);
  });
});
