import { describe, expect, it, vi } from 'vitest';
import {
  buildProvisionalRecalculationNotice,
  buildProvisionalResetMessages,
  fetchProvisionalRecalculationTargets,
  requestProvisionalReset,
} from '../provisionalRecalculation';

// 暫定適用の再算定導線の応答解釈と文言を固定する。
// 検出は画面表示のたびに呼ぶ補助情報のため、失敗しても例外にせず「対象なし」に倒す。

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('fetchProvisionalRecalculationTargets', () => {
  it('対象年度の一覧を返す', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        targets: [{ fiscalYearId: 'fy-2026', fiscalYearLabel: 'FY2026', recordCount: 12 }],
      }),
    );

    await expect(
      fetchProvisionalRecalculationTargets(fetchMock as unknown as typeof fetch),
    ).resolves.toEqual([{ fiscalYearId: 'fy-2026', fiscalYearLabel: 'FY2026', recordCount: 12 }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/calculations/provisional-recalculation');
  });

  it('エラー応答・通信失敗・想定外の形式は対象なしとして扱う', async () => {
    const errorResponse = vi.fn(async () => jsonResponse(500, { error: 'サーバー内部エラー' }));
    const networkFailure = vi.fn(async () => {
      throw new Error('network');
    });
    const malformed = vi.fn(async () => jsonResponse(200, { targets: [{ fiscalYearId: 'fy-1' }] }));

    await expect(
      fetchProvisionalRecalculationTargets(errorResponse as unknown as typeof fetch),
    ).resolves.toEqual([]);
    await expect(
      fetchProvisionalRecalculationTargets(networkFailure as unknown as typeof fetch),
    ).resolves.toEqual([]);
    await expect(
      fetchProvisionalRecalculationTargets(malformed as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });
});

describe('requestProvisionalReset', () => {
  it('fiscalYearId を POST し、差し戻し件数を返す', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { resetCount: 3 }));

    const result = await requestProvisionalReset('fy-2026', fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ kind: 'reset', resetCount: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/calculations/provisional-recalculation');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ fiscalYearId: 'fy-2026' });
  });

  it('エラー応答はサーバーの文言を、通信失敗は既定の文言を返す', async () => {
    const errorResponse = vi.fn(async () => jsonResponse(404, { error: '算定年度が見つかりません' }));
    const networkFailure = vi.fn(async () => {
      throw new Error('network');
    });

    await expect(
      requestProvisionalReset('fy-2026', errorResponse as unknown as typeof fetch),
    ).resolves.toEqual({ kind: 'failed', message: '算定年度が見つかりません' });
    await expect(
      requestProvisionalReset('fy-2026', networkFailure as unknown as typeof fetch),
    ).resolves.toEqual({ kind: 'failed', message: '再算定リクエストに失敗しました。' });
  });
});

describe('buildProvisionalRecalculationNotice', () => {
  it('対象年度と合計件数を示す', () => {
    const notice = buildProvisionalRecalculationNotice([
      { fiscalYearId: 'fy-2026', fiscalYearLabel: 'FY2026', recordCount: 12 },
      { fiscalYearId: 'fy-2025', fiscalYearLabel: 'FY2025', recordCount: 3 },
    ]);

    expect(notice).toContain('FY2026・FY2025');
    expect(notice).toContain('15 件');
  });
});

describe('buildProvisionalResetMessages', () => {
  it('差し戻し件数を合算して知らせる', () => {
    expect(
      buildProvisionalResetMessages([
        { kind: 'reset', resetCount: 12 },
        { kind: 'reset', resetCount: 3 },
      ]),
    ).toEqual(['暫定適用で算定していた 15 件を正式な排出係数で再算定します。']);
  });

  it('対象が無くなっていた場合も結果を伝える', () => {
    expect(buildProvisionalResetMessages([{ kind: 'reset', resetCount: 0 }])).toEqual([
      '再算定が必要なデータはありませんでした。',
    ]);
  });

  it('失敗した年度の文言は成功分と併記する', () => {
    expect(
      buildProvisionalResetMessages([
        { kind: 'reset', resetCount: 4 },
        { kind: 'failed', message: '算定年度が見つかりません' },
      ]),
    ).toEqual([
      '暫定適用で算定していた 4 件を正式な排出係数で再算定します。',
      '算定年度が見つかりません',
    ]);
  });
});
