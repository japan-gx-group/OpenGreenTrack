// getFallbackFiscalYearTotal の回帰テスト。
// 削減目標カードは dashboard_aggregates 行が無い年度でこの値を年間実績・基準年度実績に使う。
// dashboard_monthly_emissions の合算だけでは、直接入力方式の Scope 3（月別内訳が無く月別 RPC に
// 現れない）が抜け、集計行ができた瞬間に基準年度の分母が変わってしまう。
// Scope 3 は採用値 RPC（dashboard_scope3_category_emissions）から足すことを保証する。
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getFallbackFiscalYearTotal } from '../dashboardService';

const makeSupabase = (
  handler: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown },
): SupabaseClient =>
  ({
    rpc: async (fn: string, args: Record<string, unknown>) => handler(fn, args),
  }) as unknown as SupabaseClient;

const period = { startDate: '2025-04-01', endDate: '2026-03-31' };

describe('getFallbackFiscalYearTotal', () => {
  it('Scope 1/2 は月別 RPC、Scope 3 は採用値 RPC（年度ID指定）から合算する', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const supabase = makeSupabase((fn, args) => {
      calls.push({ fn, args });
      if (fn === 'dashboard_monthly_emissions') {
        return {
          data: [
            { monthStart: '2025-04-01', scope: 'scope1', emissions: '100' },
            { monthStart: '2025-04-01', scope: 'scope2', emissions: 40 },
            // calculated 方式のカテゴリだけが月別 RPC に現れる。採用値 RPC 側と二重計上しない。
            { monthStart: '2025-04-01', scope: 'scope3', emissions: 30 },
          ],
          error: null,
        };
      }
      return {
        data: [
          { categoryId: 1, emissions: 30 },
          { categoryId: 6, emissions: '70' },
        ],
        error: null,
      };
    });

    const total = await getFallbackFiscalYearTotal(supabase, 'fy-2025', period);

    expect(total).toBe(240);
    expect(calls.find(call => call.fn === 'dashboard_monthly_emissions')?.args).toEqual({
      p_start_date: period.startDate,
      p_end_date: period.endDate,
      p_location_id: null,
    });
    expect(calls.find(call => call.fn === 'dashboard_scope3_category_emissions')?.args).toEqual({
      p_fiscal_year_id: 'fy-2025',
    });
  });

  it('どちらかの RPC が失敗したら例外にする（0 を実績として扱わない）', async () => {
    const supabase = makeSupabase(fn =>
      fn === 'dashboard_scope3_category_emissions'
        ? { data: null, error: { message: 'boom' } }
        : { data: [], error: null },
    );

    await expect(getFallbackFiscalYearTotal(supabase, 'fy-2025', period)).rejects.toThrow(
      'Scope 3カテゴリ別排出量の取得に失敗しました',
    );
  });
});
