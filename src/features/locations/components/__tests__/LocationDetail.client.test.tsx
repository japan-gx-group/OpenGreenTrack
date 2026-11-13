// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import type { FiscalYearContextValue } from '@/contexts/fiscalYearContextValue';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { getLocationDetailData } from '../../services/locationDetailService';
import { getLocationById } from '../../services/locationService';
import type { LocationRecord } from '../../types';
import { LocationDetail } from '../LocationDetail.client';

// 拠点詳細: ヘッダーの「最新データに更新」で拠点と集計を取り直す。年度一覧の取得に失敗したときは
// 「年度が未登録」と分けて再試行を出す。形の違う ID の URL は、問い合わせずに「拠点が見つかりません」にする。
// Supabase を呼ぶ取得だけをモックする。

vi.mock('../../services/locationService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/locationService')>()),
  getLocationById: vi.fn(),
}));
vi.mock('../../services/locationDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/locationDetailService')>()),
  getLocationDetailData: vi.fn(),
}));
// 見出しは年度メニューを含み、この画面の確かめることとは関係しないので、タイトルだけにする。
vi.mock('@/components/layout/PageHeading', () => ({
  PageHeading: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('@/hooks/useFiscalYear', () => ({ useFiscalYear: vi.fn() }));
// ヘッダーの更新ボタンが増やす値を、テストから切り替えられるようにする。
const appRefresh = vi.hoisted(() => ({ refreshToken: 0 }));
vi.mock('@/hooks/useAppRefresh', () => ({
  useAppRefresh: () => ({ refreshToken: appRefresh.refreshToken, requestRefresh: () => {} }),
}));

// デモデータと同じ形の ID（版と variant の桁が 0）
const LOCATION_ID = '11111111-aaaa-0000-0000-000000000001';

const TOKYO: LocationRecord = {
  id: LOCATION_ID,
  name: '東京本社',
  region: 'Kanto',
  type: 'headquarters',
  person: '担当者',
  status: 'active',
};

const DETAIL = { hasScope3: false, hasData: false, monthlyData: [] } as unknown as Awaited<
  ReturnType<typeof getLocationDetailData>
>;

// 集計が 1 件以上ある拠点の詳細（Scope 別の数値とカテゴリ別内訳が描かれる）
const detailWithData = (scope1: number): Awaited<ReturnType<typeof getLocationDetailData>> =>
  ({
    hasScope3: false,
    hasData: true,
    monthlyData: [],
    energyBreakdown: [],
    totals: { scope1, scope2: 0, scope3: 0, total: scope1 },
  }) as unknown as Awaited<ReturnType<typeof getLocationDetailData>>;

// 取得の完了をテストから制御する（切替中の状態を確かめるため、解決を遅らせる）
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const fiscalYearValue = (overrides: Partial<FiscalYearContextValue> = {}): FiscalYearContextValue => ({
  fiscalYearId: 'fy2025',
  fiscalYear: '2025',
  fiscalYears: [{ id: 'fy2025', label: '2025年度', year: '2025', startDate: '2025-04-01', endDate: '2026-03-31' }],
  isLoading: false,
  fiscalYearError: false,
  setFiscalYearId: vi.fn(),
  refresh: vi.fn(async () => {}),
  ...overrides,
});

/** pending の Promise（then/catch/finally）を React の再描画まで含めて流し切る */
const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

// 画面の見出し・空状態の文言そのものを取り出す（ページ内の別の箇所に同じ文字列が出ても影響されないようにする）
const chartHeading = (container: HTMLElement) => container.querySelector('h2')?.textContent?.trim();
const emptyStateTitle = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.includes('活動量データはまだ登録されていません'))
    ?.textContent?.trim();

const buttonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === text);

describe('LocationDetail', () => {
  let rendered: RenderResult | null = null;

  beforeEach(() => {
    appRefresh.refreshToken = 0;
    vi.mocked(useFiscalYear).mockReturnValue(fiscalYearValue());
    vi.mocked(getLocationById).mockResolvedValue(TOKYO);
    vi.mocked(getLocationDetailData).mockResolvedValue(DETAIL);
  });

  afterEach(() => {
    rendered?.unmount();
    rendered = null;
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('「最新データに更新」で、拠点と集計を取り直す', async () => {
    rendered = render(<LocationDetail locationId={LOCATION_ID} />);
    await flushPromises();
    expect(getLocationById).toHaveBeenCalledTimes(1);
    expect(getLocationDetailData).toHaveBeenCalledTimes(1);

    appRefresh.refreshToken = 1;
    rendered.rerender(<LocationDetail locationId={LOCATION_ID} />);
    await flushPromises();
    expect(getLocationById).toHaveBeenCalledTimes(2);
    expect(getLocationDetailData).toHaveBeenCalledTimes(2);
  });

  it('年度一覧の取得に失敗したときは、年度の追加へ誘導せず、再試行を出す', async () => {
    const refresh = vi.fn(async () => {});
    vi.mocked(useFiscalYear).mockReturnValue(
      fiscalYearValue({ fiscalYearId: null, fiscalYear: '', fiscalYears: [], fiscalYearError: true, refresh }),
    );
    rendered = render(<LocationDetail locationId={LOCATION_ID} />);
    await flushPromises();

    const text = rendered.container.textContent;
    expect(text).toContain('年度を取得できませんでした');
    expect(text).not.toContain('算定年度が登録されていません');
    expect(rendered.container.querySelector('a[href="/settings/company"]')).toBeNull();

    click(buttonByText(rendered.container, '再試行')!);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('年度が本当に未登録のときは、これまでどおり企業設定へ案内する', async () => {
    vi.mocked(useFiscalYear).mockReturnValue(fiscalYearValue({ fiscalYearId: null, fiscalYear: '', fiscalYears: [] }));
    rendered = render(<LocationDetail locationId={LOCATION_ID} />);
    await flushPromises();

    expect(rendered.container.textContent).toContain('算定年度が登録されていません');
    expect(buttonByText(rendered.container, '再試行')).toBeUndefined();
  });

  it('形の違う ID の URL は、問い合わせずに「拠点が見つかりません」にする', async () => {
    rendered = render(<LocationDetail locationId="not-a-uuid" />);
    await flushPromises();

    expect(rendered.container.textContent).toContain('拠点が見つかりません');
    expect(getLocationById).not.toHaveBeenCalled();
    expect(getLocationDetailData).not.toHaveBeenCalled();
  });

  it('版と variant の桁が 0 の ID（デモデータの拠点）も、拠点として開く', async () => {
    rendered = render(<LocationDetail locationId={LOCATION_ID} />);
    await flushPromises();

    expect(getLocationById).toHaveBeenCalledWith(LOCATION_ID);
    expect(rendered.container.textContent).toContain('東京本社');
    expect(rendered.container.textContent).not.toContain('拠点が見つかりません');
  });

  describe('年度・拠点の切替中の表示', () => {
    const FY2026 = { fiscalYearId: 'fy2026', fiscalYear: '2026' };
    const OSAKA_LOCATION_ID = '11111111-aaaa-0000-0000-000000000002';
    const OSAKA: LocationRecord = { ...TOKYO, id: OSAKA_LOCATION_ID, name: '大阪支社' };

    it('年度を切り替えている間は、見出しの年度を表示中のデータの年度のままにし、取得後に新しい年度へ変える', async () => {
      vi.mocked(getLocationDetailData).mockResolvedValueOnce(detailWithData(111));
      rendered = render(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();
      expect(chartHeading(rendered.container)).toBe('月別排出量推移（2025年度）');

      const next = deferred<Awaited<ReturnType<typeof getLocationDetailData>>>();
      vi.mocked(getLocationDetailData).mockReturnValueOnce(next.promise);
      vi.mocked(useFiscalYear).mockReturnValue(fiscalYearValue(FY2026));
      rendered.rerender(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();

      // 取得の完了前: データは 2025 年度のまま残るので、見出しも 2025 年度のまま
      expect(chartHeading(rendered.container)).toBe('月別排出量推移（2025年度）');

      await act(async () => {
        next.resolve(detailWithData(222));
        await next.promise;
      });
      expect(chartHeading(rendered.container)).toBe('月別排出量推移（2026年度）');
    });

    it('年度を切り替えている間の「活動量データはまだ登録されていません」も、表示中のデータの年度で出す', async () => {
      rendered = render(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();
      expect(emptyStateTitle(rendered.container)).toBe('2025年度の活動量データはまだ登録されていません');

      vi.mocked(getLocationDetailData).mockReturnValueOnce(deferred<Awaited<ReturnType<typeof getLocationDetailData>>>().promise);
      vi.mocked(useFiscalYear).mockReturnValue(fiscalYearValue(FY2026));
      rendered.rerender(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();

      expect(emptyStateTitle(rendered.container)).toBe('2025年度の活動量データはまだ登録されていません');
    });

    it('別の拠点へ切り替えている間は、前の拠点の名前と数値を出さず、読み込み中にする', async () => {
      vi.mocked(getLocationDetailData).mockResolvedValueOnce(detailWithData(98765));
      rendered = render(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();
      expect(rendered.container.textContent).toContain('東京本社');
      expect(rendered.container.textContent).toContain('98,765');

      vi.mocked(getLocationById).mockReturnValueOnce(deferred<LocationRecord | null>().promise);
      vi.mocked(getLocationDetailData).mockReturnValueOnce(deferred<Awaited<ReturnType<typeof getLocationDetailData>>>().promise);
      rendered.rerender(<LocationDetail locationId={OSAKA_LOCATION_ID} />);
      await flushPromises();

      const text = rendered.container.textContent;
      expect(text).not.toContain('東京本社');
      expect(text).not.toContain('98,765');
      expect(text).not.toContain('拠点が見つかりません');
      expect(text).toContain('拠点別データを読み込んでいます');
    });

    it('切替先の拠点の取得だけが失敗しても、前の拠点の名前は残らない（切替先の集計だけが出る）', async () => {
      rendered = render(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();
      expect(rendered.container.textContent).toContain('東京本社');

      vi.mocked(getLocationById).mockRejectedValueOnce(new Error('拠点の取得に失敗しました'));
      vi.mocked(getLocationDetailData).mockResolvedValueOnce(detailWithData(4321));
      rendered.rerender(<LocationDetail locationId={OSAKA_LOCATION_ID} />);
      await flushPromises();

      const text = rendered.container.textContent;
      expect(text).toContain('拠点の取得に失敗しました');
      expect(text).not.toContain('東京本社');
      // 出ている数値は切替先の拠点の集計
      expect(text).toContain('4,321');
      expect(vi.mocked(getLocationById)).toHaveBeenLastCalledWith(OSAKA_LOCATION_ID);
    });

    it('切替先の拠点が取得できたら、その拠点の名前を出す', async () => {
      rendered = render(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();

      vi.mocked(getLocationById).mockResolvedValueOnce(OSAKA);
      rendered.rerender(<LocationDetail locationId={OSAKA_LOCATION_ID} />);
      await flushPromises();

      expect(rendered.container.textContent).toContain('大阪支社');
      expect(rendered.container.textContent).not.toContain('東京本社');
    });

    it('切替前の拠点の取得が遅れて終わっても、切替先の画面を上書きしない', async () => {
      const lateLocation = deferred<LocationRecord | null>();
      const lateDetail = deferred<Awaited<ReturnType<typeof getLocationDetailData>>>();
      vi.mocked(getLocationById).mockReturnValueOnce(lateLocation.promise);
      vi.mocked(getLocationDetailData).mockReturnValueOnce(lateDetail.promise);
      rendered = render(<LocationDetail locationId={LOCATION_ID} />);

      // 取得が終わらないうちに、別の拠点へ切り替える
      vi.mocked(getLocationById).mockResolvedValueOnce(OSAKA);
      vi.mocked(getLocationDetailData).mockResolvedValueOnce(detailWithData(222));
      rendered.rerender(<LocationDetail locationId={OSAKA_LOCATION_ID} />);
      await flushPromises();

      await act(async () => {
        lateLocation.resolve(TOKYO);
        lateDetail.resolve(detailWithData(111));
        await Promise.all([lateLocation.promise, lateDetail.promise]);
      });

      const text = rendered.container.textContent;
      expect(text).toContain('大阪支社');
      expect(text).toContain('222');
      expect(text).not.toContain('東京本社');
      expect(text).not.toContain('111');
    });

    it('切替先の拠点が存在しなければ、前の拠点を出さずに「拠点が見つかりません」にする', async () => {
      rendered = render(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();
      expect(rendered.container.textContent).toContain('東京本社');

      vi.mocked(getLocationById).mockResolvedValueOnce(null);
      rendered.rerender(<LocationDetail locationId={OSAKA_LOCATION_ID} />);
      await flushPromises();

      expect(rendered.container.textContent).toContain('拠点が見つかりません');
      expect(rendered.container.textContent).not.toContain('東京本社');
    });

    it('「最新データに更新」では空にせず、更新中も直前の表示を保つ', async () => {
      vi.mocked(getLocationDetailData).mockResolvedValueOnce(detailWithData(555));
      rendered = render(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();

      vi.mocked(getLocationById).mockReturnValueOnce(deferred<LocationRecord | null>().promise);
      vi.mocked(getLocationDetailData).mockReturnValueOnce(deferred<Awaited<ReturnType<typeof getLocationDetailData>>>().promise);
      appRefresh.refreshToken = 1;
      rendered.rerender(<LocationDetail locationId={LOCATION_ID} />);
      await flushPromises();

      expect(rendered.container.textContent).toContain('東京本社');
      expect(rendered.container.textContent).toContain('555');
    });
  });
});
