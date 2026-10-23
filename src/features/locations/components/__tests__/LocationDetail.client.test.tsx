// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { getLocationDetailData } from '../../services/locationDetailService';
import { getLocationById } from '../../services/locationService';
import type { LocationRecord } from '../../types';
import { LocationDetail } from '../LocationDetail.client';

// 拠点詳細（LocationDetail）が「最新データに更新」（useAppRefresh の refreshToken）に追従するかを検証する。
// 他の全データページと同じく、refreshToken の変化で拠点・集計の取得をやり直すこと（Issue #136）。
// Supabase を呼ぶ I/O だけをモックし、更新トークンを変えて再取得の呼び出し回数を見る。

vi.mock('../../services/locationService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/locationService')>()),
  getLocationById: vi.fn(),
}));

vi.mock('../../services/locationDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/locationDetailService')>()),
  getLocationDetailData: vi.fn(),
}));

// 見出しは年度メニューを内包し画面外の関心なので、タイトルだけの軽い実装に差し替える。
vi.mock('@/components/layout/PageHeading', () => ({
  PageHeading: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('@/hooks/useFiscalYear', () => ({
  useFiscalYear: () => ({
    fiscalYear: '2025',
    fiscalYearId: 'fy2025',
    fiscalYears: [{ id: 'fy2025', label: '2025年度', year: '2025' }],
    isLoading: false,
  }),
}));

// ヘッダーの更新ボタンが増やす値を、テストから直接切り替えられるようにする。
const appRefresh = vi.hoisted(() => ({ refreshToken: 0 }));
vi.mock('@/hooks/useAppRefresh', () => ({
  useAppRefresh: () => ({ refreshToken: appRefresh.refreshToken, requestRefresh: () => {} }),
}));

const TOKYO: LocationRecord = {
  id: 'loc-1',
  name: '東京本社',
  region: 'Kanto',
  type: 'headquarters',
  person: '担当者',
  status: 'active',
} as LocationRecord;

const DETAIL = {
  hasScope3: false,
  monthlyData: [],
} as unknown as Awaited<ReturnType<typeof getLocationDetailData>>;

/** pending の Promise（then/catch/finally）を React の再レンダリングまで含めて流し切る */
const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

describe('LocationDetail refresh', () => {
  let rendered: RenderResult | null = null;

  beforeEach(() => {
    appRefresh.refreshToken = 0;
    vi.mocked(getLocationById).mockResolvedValue(TOKYO);
    vi.mocked(getLocationDetailData).mockResolvedValue(DETAIL);
  });

  afterEach(() => {
    rendered?.unmount();
    rendered = null;
    vi.clearAllMocks();
  });

  it('re-fetches location and aggregates when the header refresh token changes', async () => {
    rendered = render(<LocationDetail locationId="loc-1" />);
    await flushPromises();

    expect(getLocationDetailData).toHaveBeenCalledTimes(1);
    expect(getLocationById).toHaveBeenCalledTimes(1);

    // ヘッダーの「最新データに更新」を押すと refreshToken が増える
    appRefresh.refreshToken = 1;
    rendered.rerender(<LocationDetail locationId="loc-1" />);
    await flushPromises();

    expect(getLocationDetailData).toHaveBeenCalledTimes(2);
    expect(getLocationById).toHaveBeenCalledTimes(2);
  });
});
