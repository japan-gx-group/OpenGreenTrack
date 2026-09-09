// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import type { LocationDeletionImpact } from '../../services/locationDeletionGuard';
import {
  countScope3StackedRecords,
  deleteLocation,
  getLocationDeletionImpact,
  getLocations,
} from '../../services/locationService';
import type { LocationRecord } from '../../types';
import { Locations } from '../Locations.client';

// 拠点一覧（Locations）の削除確認モーダルのコンポーネントテスト。
// Supabase を呼ぶ I/O（一覧取得・削除影響・Scope3 件数・削除）だけをモックし、
// 「削除影響の取得結果に応じて『削除する』が正しく無効化されるか」を検証する。
// 取得失敗時に deletionImpact が null のままボタンが活性になる見落としを機械的に検知する。

vi.mock('../../services/locationService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/locationService')>()),
  getLocations: vi.fn(),
  getLocationDeletionImpact: vi.fn(),
  countScope3StackedRecords: vi.fn(),
  deleteLocation: vi.fn(),
}));

// App Router のフックと全体更新コンテキストは画面外の依存なので固定値を返す。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/hooks/useAppRefresh', () => ({
  useAppRefresh: () => ({ refreshToken: 0, requestRefresh: () => {} }),
}));

const TOKYO: LocationRecord = {
  id: 'loc-1',
  name: '東京本社',
  region: 'Kanto',
  type: 'headquarters',
  person: '担当者',
  status: 'active',
};

const NO_LINKED_DATA: LocationDeletionImpact = {
  activityRecordCount: 0,
  emissionResultCount: 0,
  uncalculatedCount: 0,
  periodFrom: null,
  periodTo: null,
};

/** pending の Promise（then/catch/finally）を React の再レンダリングまで含めて流し切る */
const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

/** 削除確認モーダルの要素を返す。開いていなければ例外にしてテストを落とす */
const deleteDialog = (): HTMLElement => {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('削除確認モーダルが開いていません');
  return dialog;
};

const findButton = (root: ParentNode, label: string): HTMLButtonElement => {
  const button = Array.from(root.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label,
  );
  if (!button) throw new Error(`ボタンが見つかりません: ${label}`);
  return button;
};

/** 一覧を描画し、行メニュー（⋮）→「削除」で削除確認モーダルを開く */
const openDeleteModal = async (): Promise<RenderResult> => {
  const rendered = render(<Locations />);
  await flushPromises();
  const menuTrigger = rendered.container.querySelector<HTMLButtonElement>('button[title="操作"]');
  if (!menuTrigger) throw new Error('行メニューのボタンが見つかりません');
  click(menuTrigger);
  click(findButton(rendered.container, '削除'));
  await flushPromises();
  return rendered;
};

describe('Locations 削除確認モーダル', () => {
  beforeEach(() => {
    vi.mocked(getLocations).mockResolvedValue([TOKYO]);
    vi.mocked(countScope3StackedRecords).mockResolvedValue(0);
    vi.mocked(deleteLocation).mockResolvedValue({ refreshedFiscalYearIds: [], warning: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('削除影響の取得に失敗したら「削除する」を無効化し、再試行の導線を出す', async () => {
    vi.mocked(getLocationDeletionImpact).mockRejectedValue(new Error('network error'));
    const { unmount } = await openDeleteModal();

    const dialog = deleteDialog();
    expect(dialog.textContent).toContain('削除の影響範囲を取得できなかったため削除できません');
    expect(findButton(dialog, '削除する').disabled).toBe(true);
    expect(findButton(dialog, '再試行')).toBeTruthy();

    // 無効化されたボタンを押しても削除は走らない
    click(findButton(dialog, '削除する'));
    await flushPromises();
    expect(deleteLocation).not.toHaveBeenCalled();

    unmount();
  });

  it('「再試行」で取得し直し、成功すれば「削除する」が有効になる', async () => {
    vi.mocked(getLocationDeletionImpact)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(NO_LINKED_DATA);
    const { unmount } = await openDeleteModal();

    click(findButton(deleteDialog(), '再試行'));
    await flushPromises();

    expect(getLocationDeletionImpact).toHaveBeenCalledTimes(2);
    expect(getLocationDeletionImpact).toHaveBeenLastCalledWith(TOKYO.id);
    const dialog = deleteDialog();
    expect(dialog.textContent).not.toContain('取得できなかったため');
    expect(dialog.textContent).toContain('活動量データ・算定結果はありません');
    expect(findButton(dialog, '削除する').disabled).toBe(false);

    unmount();
  });

  it('取得に成功していれば「削除する」は有効で、押すと削除が実行される', async () => {
    vi.mocked(getLocationDeletionImpact).mockResolvedValue(NO_LINKED_DATA);
    const { unmount } = await openDeleteModal();

    const deleteButton = findButton(deleteDialog(), '削除する');
    expect(deleteButton.disabled).toBe(false);
    click(deleteButton);
    await flushPromises();
    expect(deleteLocation).toHaveBeenCalledWith(TOKYO.id);

    unmount();
  });
});
