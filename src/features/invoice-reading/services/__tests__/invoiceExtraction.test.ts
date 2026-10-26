import { describe, expect, it } from 'vitest';
import { findPortableSchemaProblems } from '@/lib/ai/schema';
import {
  INVOICE_EXTRACTION_SCHEMA,
  normalizeRegistrationNumber,
  validateInvoiceExtraction,
} from '../invoiceExtraction';

const item = (overrides: Record<string, unknown> = {}) => ({
  kind: 'electricity',
  planName: '従量電灯B',
  fuelName: null,
  usageMonth: '2025-09',
  periodStart: '2025-08-05',
  periodEnd: '2025-09-03',
  amount: 12345,
  unit: 'kWh',
  ...overrides,
});

const output = (overrides: Record<string, unknown> = {}) => ({
  kind: 'electricity',
  supplierName: '東京電力エナジーパートナー株式会社',
  supplierRegistrationNumber: 'A0269',
  supplyAddress: '東京都架空区架空町1丁目1番1号',
  items: [item()],
  warnings: [],
  ...overrides,
});

describe('INVOICE_EXTRACTION_SCHEMA', () => {
  it('3 社で使える書き方になっている（共通の入口の確認を通る）', () => {
    expect(findPortableSchemaProblems(INVOICE_EXTRACTION_SCHEMA)).toEqual([]);
  });
});

describe('normalizeRegistrationNumber', () => {
  it('全角・小文字・空白を許して A と 4 桁の形にそろえる', () => {
    expect(normalizeRegistrationNumber('Ａ０２６９')).toBe('A0269');
    expect(normalizeRegistrationNumber(' a 0269 ')).toBe('A0269');
  });

  it('形が違えば null', () => {
    expect(normalizeRegistrationNumber('A269')).toBeNull();
    expect(normalizeRegistrationNumber('B0269')).toBeNull();
    expect(normalizeRegistrationNumber(269)).toBeNull();
  });
});

describe('validateInvoiceExtraction', () => {
  it('形が合っていれば、そのまま読み取った内容として返す', () => {
    expect(validateInvoiceExtraction(output())).toEqual({
      kind: 'electricity',
      supplierName: '東京電力エナジーパートナー株式会社',
      supplierRegistrationNumber: 'A0269',
      supplyAddress: '東京都架空区架空町1丁目1番1号',
      items: [item()],
      warnings: [],
    });
  });

  it('いちばん外側の形が違えば null（共通の入口が bad_response にする）', () => {
    expect(validateInvoiceExtraction(null)).toBeNull();
    expect(validateInvoiceExtraction(output({ kind: 'water' }))).toBeNull();
    expect(validateInvoiceExtraction(output({ items: 'x' }))).toBeNull();
    expect(validateInvoiceExtraction(output({ warnings: undefined }))).toBeNull();
  });

  it('形の違う値は推測で直さず null に落とす（年月・日付・使用量）', () => {
    const result = validateInvoiceExtraction(
      output({
        items: [
          item({ usageMonth: '2025-13', periodStart: '2025-02-30', periodEnd: '2025/09/03', amount: -1, unit: '' }),
          item({ usageMonth: '令和7年9月', amount: Number.NaN }),
        ],
      }),
    );
    expect(result?.items[0]).toMatchObject({ usageMonth: null, periodStart: null, periodEnd: null, amount: null, unit: null });
    expect(result?.items[1]).toMatchObject({ usageMonth: null, amount: null });
  });

  it('種類が分からない明細は捨て、文字は空白をそろえて長すぎれば切る', () => {
    const result = validateInvoiceExtraction(
      output({
        items: [item({ kind: 'telephone' }), item({ planName: '  業務用\n電力  ', fuelName: 'x'.repeat(300) })],
      }),
    );
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].planName).toBe('業務用 電力');
    expect(result?.items[0].fuelName).toHaveLength(200);
  });

  it('明細が 10 件を超えたら先頭の 10 件にし、そのことを注意として残す', () => {
    const result = validateInvoiceExtraction(output({ items: Array.from({ length: 12 }, () => item()) }));
    expect(result?.items).toHaveLength(10);
    expect(result?.warnings).toEqual(['明細が 10 件を超えたため、先頭の 10 件だけを読み取りました']);
  });
});
