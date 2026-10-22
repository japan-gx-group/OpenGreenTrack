import { describe, expect, it, vi } from 'vitest';
import {
  buildFactorResetMessages,
  hasCalculationInputChanged,
  requestFactorRecalculationReset,
} from '../factorRecalculation';

// 係数値を変えたときの再算定導線（係数管理画面）の、応答の解釈と文言を固定する。

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('hasCalculationInputChanged', () => {
  it('係数値か単位が変わったときだけ true（名称・出典だけの変更では算定結果は変わらない）', () => {
    const before = { factorValue: 0.00045, unit: 't-CO2/kWh' };
    expect(hasCalculationInputChanged(before, { factorValue: 0.00045, unit: 't-CO2/kWh' })).toBe(false);
    expect(hasCalculationInputChanged(before, { factorValue: 0.0004, unit: 't-CO2/kWh' })).toBe(true);
    expect(hasCalculationInputChanged(before, { factorValue: 0.00045, unit: 't-CO2/MWh' })).toBe(true);
  });
});

describe('requestFactorRecalculationReset', () => {
  it('factorId を POST し、件数と算定する年度を返す', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { resetCount: 3, skippedCount: 1, fiscalYearIds: ['fy-2026'] }),
    );

    const result = await requestFactorRecalculationReset('factor-1', fetchMock as unknown as typeof fetch);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/calculations/factor-recalculation');
    expect(JSON.parse(init.body as string)).toEqual({ factorId: 'factor-1' });
    expect(result).toEqual({ kind: 'reset', resetCount: 3, skippedCount: 1, fiscalYearIds: ['fy-2026'] });
  });

  it('エラー応答は本文のエラー文言で failed にする', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404, { error: '排出係数が見つかりません' }));

    const result = await requestFactorRecalculationReset('factor-1', fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ kind: 'failed', message: '排出係数が見つかりません' });
  });

  it('ネットワーク例外は throw せず failed にする', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await requestFactorRecalculationReset('factor-1', fetchMock as unknown as typeof fetch);

    expect(result.kind).toBe('failed');
  });
});

describe('buildFactorResetMessages', () => {
  it('戻した件数と、算定年度が無く残した件数を伝える', () => {
    expect(
      buildFactorResetMessages('電気 PPA', {
        kind: 'reset',
        resetCount: 3,
        skippedCount: 1,
        fiscalYearIds: ['fy-2026'],
      }),
    ).toEqual([
      '「電気 PPA」の変更後の値で 3 件を再算定します。',
      '1 件は対象期間の算定年度が登録されていないため、変更前の値の算定結果のまま残しました。',
    ]);
  });

  it('対象が無くなっていればその旨、失敗なら保存は済んでいることを伝える', () => {
    expect(
      buildFactorResetMessages('電気 PPA', { kind: 'reset', resetCount: 0, skippedCount: 0, fiscalYearIds: [] }),
    ).toEqual(['「電気 PPA」で算定済みのデータはありませんでした。']);
    expect(buildFactorResetMessages('電気 PPA', { kind: 'failed', message: '混雑中' })).toEqual([
      '「電気 PPA」は更新しましたが、再算定を開始できませんでした: 混雑中',
    ]);
  });
});
