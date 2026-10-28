// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import {
  addManualActivityRecord,
  updateManualActivityRecord,
} from '../../services/activityRecordService';
import type { BulkSaveItem } from '../../services/bulkEntry';
import { linkEvidence } from '@/features/activity-evidence/services/evidenceClient';
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

vi.mock('@/features/activity-evidence/services/evidenceClient', () => ({ linkEvidence: vi.fn() }));

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
  evidenceCount: 0,
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

describe('useActivityEntrySave.save（帳票の紐づけ）', () => {
  const entry = item('2024-11').entry;

  beforeEach(() => {
    vi.mocked(addManualActivityRecord).mockReset().mockResolvedValue(record({ id: 'rec-1', periodStart: '2024-11-01' }));
    vi.mocked(linkEvidence).mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    latest = null;
  });

  it('保存した記録に帳票を紐づけ、履歴に足す記録に帳票の数を入れる', async () => {
    vi.mocked(linkEvidence).mockResolvedValue(undefined);
    const { params } = setup();
    await latest!.save(entry, { evidenceFileIds: ['file-1', 'file-2'] });

    expect(linkEvidence).toHaveBeenCalledWith('rec-1', ['file-1', 'file-2']);
    expect(params.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec-1', evidenceCount: 2 }));
  });

  it('帳票が無ければ紐づけを呼ばない', async () => {
    setup();
    await latest!.save(entry);
    expect(linkEvidence).not.toHaveBeenCalled();
  });

  it('紐づけに失敗しても記録の保存は成功として進め、保存の通知の中で紐づけ直しを案内する（成功の通知で上書きしない）', async () => {
    vi.mocked(linkEvidence).mockRejectedValue(new Error('boom'));
    const { params } = setup();
    await latest!.save(entry, { evidenceFileIds: ['file-1'] });

    expect(params.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec-1', evidenceCount: 0 }));
    expect(params.showToast).toHaveBeenCalledTimes(1);
    const [message, type] = vi.mocked(params.showToast).mock.calls[0];
    expect(message).toMatch(/を登録しましたが、帳票を紐づけられませんでした。入力履歴から記録を開いて、帳票を追加し直してください$/);
    expect(type).toBe('error');
    expect(params.runAutoCalculation).toHaveBeenCalledWith(['2024-11-01']);
  });

  it('紐づけに失敗したあとに計算結果を通知するときも、紐づけられなかったことを残す', async () => {
    vi.mocked(linkEvidence).mockRejectedValue(new Error('boom'));
    const { params } = setup();
    vi.mocked(params.runAutoCalculation).mockResolvedValue(['2024年11月の排出量を計算しました']);
    await latest!.save(entry, { evidenceFileIds: ['file-1'] });

    expect(params.showToast).toHaveBeenLastCalledWith(
      '記録は登録しましたが、帳票を紐づけられませんでした。入力履歴から記録を開いて、帳票を追加し直してください\n2024年11月の排出量を計算しました',
      'error',
    );
  });
});

describe('useActivityEntrySave.saveMany（請求書の一括登録）', () => {
  const many = (key: string, month: string, evidenceFileIds: string[] = ['file-1']) => ({
    key,
    entry: item(month).entry,
    evidenceFileIds,
  });

  beforeEach(() => {
    vi.mocked(addManualActivityRecord)
      .mockReset()
      .mockImplementation(async (input) => record({ id: `new-${input.periodStart}`, periodStart: input.periodStart }));
    vi.mocked(linkEvidence).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    latest = null;
  });

  it('1 件ずつ保存して帳票を紐づけ、失敗した行があっても残りを続け、算定は保存できた月で 1 回だけ行う', async () => {
    vi.mocked(addManualActivityRecord)
      .mockImplementationOnce(async (input) => record({ id: 'rec-a', periodStart: input.periodStart }))
      .mockRejectedValueOnce(new Error('同じ拠点・カテゴリ・対象年月の活動量が既に登録済みです。'));
    const { params } = setup();
    vi.mocked(params.runAutoCalculation).mockResolvedValue(['2件を算定しました']);

    const result = await latest!.saveMany([many('a', '2024-11'), many('b', '2024-11'), many('c', '2024-12', ['file-2'])]);

    expect(result).toEqual({
      savedKeys: ['a', 'c'],
      failures: [{ key: 'b', reason: '同じ拠点・カテゴリ・対象年月の活動量が既に登録済みです。' }],
    });
    expect(vi.mocked(linkEvidence).mock.calls).toEqual([
      ['rec-a', ['file-1']],
      ['new-2024-12-01', ['file-2']],
    ]);
    expect(params.runAutoCalculation).toHaveBeenCalledTimes(1);
    expect(params.runAutoCalculation).toHaveBeenCalledWith(['2024-11-01', '2024-12-01']);
    expect(params.refreshHistory).toHaveBeenCalledTimes(1);
    expect(params.onBulkSaved).toHaveBeenCalledTimes(1);
    expect(params.showToast).toHaveBeenNthCalledWith(1, '請求書から 2 件の活動量を登録しました。排出量を計算しています...', 'success');
    expect(params.showToast).toHaveBeenNthCalledWith(
      2,
      ['1 件は登録できませんでした。表の理由を確かめてください。', '2件を算定しました'].join('\n'),
      'error',
    );
  });

  it('紐づけに失敗しても記録は保存できた行として返し、紐づけ直しを案内する', async () => {
    vi.mocked(linkEvidence).mockRejectedValue(new Error('boom'));
    const { params } = setup();

    const result = await latest!.saveMany([many('a', '2024-11')]);

    expect(result).toEqual({ savedKeys: ['a'], failures: [] });
    expect(params.showToast).toHaveBeenLastCalledWith(
      '1 件は記録を登録しましたが、帳票を紐づけられませんでした。入力履歴から記録を開いて、帳票を追加し直してください',
      'error',
    );
  });

  it('すべて失敗したら算定も履歴の取り直しもせず、失敗を伝える', async () => {
    vi.mocked(addManualActivityRecord).mockReset().mockRejectedValue(new Error('活動量レコードの登録に失敗しました'));
    const { params } = setup();

    const result = await latest!.saveMany([many('a', '2024-11')]);

    expect(result.savedKeys).toEqual([]);
    expect(linkEvidence).not.toHaveBeenCalled();
    expect(params.runAutoCalculation).not.toHaveBeenCalled();
    expect(params.refreshHistory).not.toHaveBeenCalled();
    expect(params.showToast).toHaveBeenCalledWith('選んだ明細を登録できませんでした（1 件）。表の理由を確かめてください。', 'error');
  });
});
