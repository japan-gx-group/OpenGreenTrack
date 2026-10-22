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

  it('keeps the created count and reloads the list when the update step throws', async () => {
    vi.mocked(addLocations).mockResolvedValue({ created: [{ id: 'n1' }, { id: 'n2' }] as LocationRecord[], failures: [] });
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
    vi.mocked(addLocations).mockResolvedValue({ created: [], failures: [] });
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
});
