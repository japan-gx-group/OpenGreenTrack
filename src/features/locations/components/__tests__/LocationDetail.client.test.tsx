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
});
