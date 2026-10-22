// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import {
  addManualActivityRecord,
  updateManualActivityRecord,
} from '../../services/activityRecordService';
import type { BulkSaveItem } from '../../services/bulkEntry';
import type { SavedManualActivityRecord } from '../../types';
import {
  useActivityEntrySave,
  type ActivityEntrySave,
  type UseActivityEntrySaveParams,
} from '../useActivityEntrySave';

// 一括保存（saveBulk）の回帰テスト。
// 月順に 1 件ずつ保存し、途中で失敗しても保存済みの月は取り消さず、算定・履歴反映は保存済み分に対して
// 行ってから「何件保存済みか」を含むエラーで失敗を伝えることを固定する。

vi.mock('../../services/activityRecordService', () => ({
  addManualActivityRecord: vi.fn(),
  addScope3ActivityRecord: vi.fn(),
  updateManualActivityRecord: vi.fn(),
  updateScope3ActivityRecord: vi.fn(),
}));

const record = (
  overrides: Partial<SavedManualActivityRecord> & Pick<SavedManualActivityRecord, 'id' | 'periodStart'>,
): SavedManualActivityRecord => ({
  locationId: 'loc-1',
  locationName: '大阪支社',
  energyType: 'electricity',
  amount: 100,
  unit: 'kWh',
  periodEnd: overrides.periodStart.replace(/-01$/, '-28'),
  note: null,
  createdAt: '2025-01-15T00:00:00Z',
  emissionFactorId: null,
  emissions: null,
  appliedFactorName: null,
  appliedFactorValue: null,
  appliedFactorUnit: null,
  scope3CategoryId: null,
  ideaFactorId: null,
  ideaProductName: null,
  ...overrides,
});

const item = (month: string, action: 'create' | 'overwrite' = 'create'): BulkSaveItem => {
  const entry = {
    kind: 'scope12' as const,
    input: {
      locationId: 'loc-1',
      energyType: 'electricity' as const,
      amount: 100,
      unit: 'kWh',
      periodStart: `${month}-01`,
      periodEnd: `${month}-28`,
      note: null,
      emissionFactorId: null,
    },
  };
  const [year, monthText] = month.split('-');
  const label = `${year}年${Number(monthText)}月`;
  return action === 'overwrite'
    ? { action, month, label, recordId: `rec-${month}`, entry }
    : { action, month, label, entry };
};

let latest: ActivityEntrySave | null = null;

// フックの戻り値をテスト側へ渡す。render 中の外部変数への代入は副作用になるため effect で行う
// （render は act で包まれており、戻った時点で effect まで反映済み）。
const Probe = (params: UseActivityEntrySaveParams) => {
  const save = useActivityEntrySave(params);
  useEffect(() => {
    latest = save;
  });
  return null;
};

const setup = () => {
  const params: UseActivityEntrySaveParams = {
    onSaved: vi.fn(),
    onBulkSaved: vi.fn(),
    runAutoCalculation: vi.fn(async () => []),
    refreshHistory: vi.fn(async () => {}),
    showToast: vi.fn(),
  };
  const rendered = render(<Probe {...params} />);
  return { params, rendered, saveBulk: latest!.saveBulk };
};

describe('useActivityEntrySave.saveBulk', () => {
  beforeEach(() => {
    vi.mocked(addManualActivityRecord).mockReset();
    vi.mocked(updateManualActivityRecord).mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    latest = null;
  });

  it('月順に保存し、算定は 1 回にまとめて履歴を取り直す（新規・上書きの内訳を通知する）', async () => {
    vi.mocked(addManualActivityRecord).mockImplementation(async (input) =>
      record({ id: `new-${input.periodStart}`, periodStart: input.periodStart }),
    );
    vi.mocked(updateManualActivityRecord).mockImplementation(async (id, input) =>
      record({ id, periodStart: input.periodStart }),
    );
    const { params, saveBulk } = setup();
    vi.mocked(params.runAutoCalculation).mockResolvedValue(['2件を算定しました']);

    await saveBulk([item('2024-11'), item('2024-12', 'overwrite')]);

    expect(addManualActivityRecord).toHaveBeenCalledTimes(1);
    expect(updateManualActivityRecord).toHaveBeenCalledWith('rec-2024-12', expect.objectContaining({ periodStart: '2024-12-01' }));
    expect(params.runAutoCalculation).toHaveBeenCalledTimes(1);
    expect(params.runAutoCalculation).toHaveBeenCalledWith(['2024-11-01', '2024-12-01']);
    expect(params.refreshHistory).toHaveBeenCalledTimes(1);
    expect(params.onBulkSaved).toHaveBeenCalledTimes(1);
    expect(params.showToast).toHaveBeenNthCalledWith(
      1,
      '『大阪支社』の電気データを2ヶ月分保存しました（新規1件・上書き1件）。排出量を計算しています...',
      'success',
    );
    expect(params.showToast).toHaveBeenNthCalledWith(2, '2件を算定しました', 'success');
  });

  it('2 件目で失敗したら保存済み件数を含むエラーを投げ、算定・履歴反映は保存済みの月に対して行う', async () => {
    vi.mocked(addManualActivityRecord)
      .mockResolvedValueOnce(record({ id: 'new-nov', periodStart: '2024-11-01' }))
      .mockRejectedValueOnce(new Error('同じ拠点・カテゴリ・対象年月の活動量が既に登録済みです。'));
    const { params, saveBulk } = setup();
    vi.mocked(params.runAutoCalculation).mockResolvedValue(['1件を算定しました', '1件は係数が無く未算定です']);

    await expect(saveBulk([item('2024-11'), item('2024-12'), item('2025-01')])).rejects.toThrow(
      '2024年12月の保存に失敗しました（1件は保存済みです）: 同じ拠点・カテゴリ・対象年月の活動量が既に登録済みです。',
    );

    // 失敗した月より後の月は保存を試みない。
    expect(addManualActivityRecord).toHaveBeenCalledTimes(2);
    expect(params.runAutoCalculation).toHaveBeenCalledTimes(1);
    expect(params.runAutoCalculation).toHaveBeenCalledWith(['2024-11-01']);
    expect(params.refreshHistory).toHaveBeenCalledTimes(1);
    expect(params.onBulkSaved).toHaveBeenCalledTimes(1);
    // 保存済みの月の算定結果は捨てず、保存済み件数と一緒にトーストで残す。
    expect(params.showToast).toHaveBeenCalledTimes(1);
    expect(params.showToast).toHaveBeenCalledWith(
      [
        '『大阪支社』の電気データを1ヶ月分保存しました。2024年12月以降は保存されていません。',
        '1件を算定しました',
        '1件は係数が無く未算定です',
      ].join('\n'),
      'error',
    );
  });

  it('1 件目で失敗したら失敗理由だけを投げ、算定・履歴反映は行わない', async () => {
    vi.mocked(addManualActivityRecord).mockRejectedValueOnce(new Error('活動量レコードの登録に失敗しました'));
    const { params, saveBulk } = setup();

    await expect(saveBulk([item('2024-11'), item('2024-12')])).rejects.toThrow(
      '活動量レコードの登録に失敗しました',
    );

    expect(addManualActivityRecord).toHaveBeenCalledTimes(1);
    expect(params.runAutoCalculation).not.toHaveBeenCalled();
    expect(params.refreshHistory).not.toHaveBeenCalled();
    expect(params.onBulkSaved).not.toHaveBeenCalled();
    expect(params.showToast).not.toHaveBeenCalled();
  });
});
