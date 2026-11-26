// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import type { ShowToast } from '@/hooks/useToast';
import { addLocations, updateLocations } from '../../services/locationService';
import { buildLocationImportPlan, decodeLocationCsvBuffer, type LocationImportPlan } from '../../services/locationCsvImport';
import type { LocationRecord } from '../../types';
import { useLocationCsvImport, type LocationCsvImportController } from '../useLocationCsvImport';

// useLocationCsvImport の回帰テスト。
// 作成は反映済みで更新側が throw した場合も、反映済みの件数を通知し一覧を取り直すことを固定する。

vi.mock('../../services/locationService', () => ({
  addLocations: vi.fn(),
  updateLocations: vi.fn(),
}));
vi.mock('../../services/locationCsvImport', () => ({
  buildLocationImportPlan: vi.fn(),
  decodeLocationCsvBuffer: vi.fn(),
}));

const plan = {
  creates: [{ row: 2, location: {} }, { row: 3, location: {} }],
  updates: [{ row: 4, targetId: 'l1', location: {} }],
  errors: [],
  skipCount: 0,
  exampleRowCount: 0,
} as unknown as LocationImportPlan;

let controller: LocationCsvImportController;
// レンダリング中にモジュール変数へ直接代入すると react-hooks/globals に弾かれるため、関数を経由して受け取る。
const capture = (value: LocationCsvImportController) => { controller = value; };

const Probe = ({ reload, showToast }: { reload: () => Promise<void>; showToast: ShowToast }) => {
  capture(useLocationCsvImport([], reload, showToast));
  return null;
};

describe('useLocationCsvImport', () => {
  beforeEach(() => {
    vi.mocked(decodeLocationCsvBuffer).mockReturnValue('');
    vi.mocked(buildLocationImportPlan).mockReturnValue(plan);
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('combines create and update progress into one total', async () => {
    vi.mocked(addLocations).mockImplementation(async (_rows, onProgress) => {
      onProgress?.(2);
      return { created: [{ id: 'n1' }, { id: 'n2' }] as LocationRecord[], failures: [], stopped: null };
    });
    vi.mocked(updateLocations).mockImplementation(async (_rows, onProgress) => {
      onProgress?.(1);
      return { updated: [{ id: 'l1' }] as LocationRecord[], failures: [], stopped: null };
    });
    const reload = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const file = { name: 'locations.csv', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
    const { unmount } = render(<Probe reload={reload} showToast={showToast} />);
    await act(async () => { await controller.selectFile(file); });
    await act(async () => { await controller.runImport(); });

    expect(controller.completedCount).toBe(3);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('追加2件・更新1件'), 'success');
    unmount();
  });

  it('keeps the created count and reloads the list when the update step throws', async () => {
    vi.mocked(addLocations).mockResolvedValue({ created: [{ id: 'n1' }, { id: 'n2' }] as LocationRecord[], failures: [], stopped: null });
    vi.mocked(updateLocations).mockRejectedValue(new Error('network down'));
    const reload = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const file = { name: 'locations.csv', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;

    const { unmount } = render(<Probe reload={reload} showToast={showToast} />);
    await act(async () => { await controller.selectFile(file); });
    await act(async () => { await controller.runImport(); });

    expect(reload).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('追加2件'), 'error');
    unmount();
  });

  it('reloads the list when the update step throws before anything is created', async () => {
    vi.mocked(addLocations).mockResolvedValue({ created: [], failures: [], stopped: null });
    vi.mocked(updateLocations).mockRejectedValue(new Error('network down'));
    const reload = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const file = { name: 'locations.csv', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;

    const { unmount } = render(<Probe reload={reload} showToast={showToast} />);
    await act(async () => { await controller.selectFile(file); });
    await act(async () => { await controller.runImport(); });

    expect(reload).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('更新件数不明'), 'error');
    unmount();
  });

  it('reloads the list and marks the count unknown when the create step throws', async () => {
    vi.mocked(addLocations).mockRejectedValue(new Error('network down'));
    const reload = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const file = { name: 'locations.csv', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;

    const { unmount } = render(<Probe reload={reload} showToast={showToast} />);
    await act(async () => { await controller.selectFile(file); });
    await act(async () => { await controller.runImport(); });

    expect(reload).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('追加件数不明'), 'error');
    expect(updateLocations).not.toHaveBeenCalled();
    unmount();
  });

  it('リクエスト全体が原因で登録が止まったら、更新を実行せず、エラー1件として残りの件数とともに通知する', async () => {
    vi.mocked(addLocations).mockResolvedValue({
      created: [{ id: 'n1' }] as LocationRecord[],
      failures: [],
      stopped: {
        reason: 'ログイン情報が確認できませんでした。再度ログインしてから取り込み直してください',
        unconfirmedCount: 0,
      },
    });
    const reload = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const file = { name: 'locations.csv', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;

    const { unmount } = render(<Probe reload={reload} showToast={showToast} />);
    await act(async () => { await controller.selectFile(file); });
    await act(async () => { await controller.runImport(); });

    expect(updateLocations).not.toHaveBeenCalled();
    // 行エラーは並べない（plan.errors は空）
    expect(controller.importErrors).toEqual([]);
    expect(showToast).toHaveBeenCalledTimes(1);
    // 追加 2 件中 1 件は登録済み、残りの追加 1 件と更新 1 件は試みていない
    expect(showToast).toHaveBeenCalledWith(
      'CSVインポートが途中で失敗しました（ログイン情報が確認できませんでした。再度ログインしてから取り込み直してください。' +
        '残りの2件は取り込んでいません）: 追加1件・更新0件・スキップ0件・エラー0件',
      'error',
    );
    expect(reload).toHaveBeenCalled();
    unmount();
  });

  it('応答が届かず反映を確認できない行は「取り込んでいない」に数えず、確かめるよう案内する', async () => {
    vi.mocked(addLocations).mockResolvedValue({
      created: [],
      failures: [],
      stopped: { reason: '拠点の登録に失敗しました（詳細: FetchError: Failed to fetch）', unconfirmedCount: 2 },
    });
    const reload = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const file = { name: 'locations.csv', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;

    const { unmount } = render(<Probe reload={reload} showToast={showToast} />);
    await act(async () => { await controller.selectFile(file); });
    await act(async () => { await controller.runImport(); });

    // 追加 2 件は確認できず、更新 1 件は試みていない
    expect(showToast).toHaveBeenCalledWith(
      'CSVインポートが途中で失敗しました（拠点の登録に失敗しました（詳細: FetchError: Failed to fetch）。' +
        '2件は反映されたか確認できません。一覧で確かめてから取り込み直してください。' +
        '残りの1件は取り込んでいません）: 追加0件・更新0件・スキップ0件・エラー0件',
      'error',
    );
    expect(reload).toHaveBeenCalled();
    unmount();
  });

  it('途中で止まった後に一覧の再取得も失敗したら、「取込は完了しました」とは知らせない', async () => {
    vi.mocked(addLocations).mockResolvedValue({
      created: [],
      failures: [],
      stopped: {
        reason: 'ログイン情報が確認できませんでした。再度ログインしてから取り込み直してください',
        unconfirmedCount: 0,
      },
    });
    const reload = vi.fn().mockRejectedValue(new Error('JWT expired'));
    const showToast = vi.fn();
    const file = { name: 'locations.csv', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;

    const { unmount } = render(<Probe reload={reload} showToast={showToast} />);
    await act(async () => { await controller.selectFile(file); });
    await act(async () => { await controller.runImport(); });

    expect(showToast).toHaveBeenLastCalledWith('一覧の再取得にも失敗しました。画面を再読み込みしてください。', 'error');
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('取込は完了しました'), 'error');
    unmount();
  });

  it('更新の途中で止まったら、行エラーを並べずにエラー1件として通知する', async () => {
    vi.mocked(addLocations).mockResolvedValue({
      created: [{ id: 'n1' }, { id: 'n2' }] as LocationRecord[], failures: [], stopped: null,
    });
    vi.mocked(updateLocations).mockResolvedValue({
      updated: [],
      failures: [],
      stopped: {
        reason: 'ログイン情報が確認できませんでした。再度ログインしてから取り込み直してください',
        unconfirmedCount: 0,
      },
    });
    const reload = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const file = { name: 'locations.csv', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;

    const { unmount } = render(<Probe reload={reload} showToast={showToast} />);
    await act(async () => { await controller.selectFile(file); });
    await act(async () => { await controller.runImport(); });

    expect(controller.importErrors).toEqual([]);
    expect(showToast).toHaveBeenCalledWith(
      'CSVインポートが途中で失敗しました（ログイン情報が確認できませんでした。再度ログインしてから取り込み直してください。' +
        '残りの1件は取り込んでいません）: 追加2件・更新0件・スキップ0件・エラー0件',
      'error',
    );
    expect(reload).toHaveBeenCalled();
    unmount();
  });
});
