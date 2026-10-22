// toHistoryItem の「適用係数」表示とキーワード検索の回帰テスト。
// 一覧の適用係数列は emission_results のスナップショット（実際に算定で適用された係数）を表示し、
// 事業者名・係数名・値でもキーワード検索に当たることを固定する。
import { describe, expect, it } from 'vitest';
import { toHistoryItem } from '../useActivityHistory';
import {
  DEFAULT_HISTORY_FILTERS,
  filterActivityHistory,
} from '../../services/activityHistoryFilter';
import type { SavedManualActivityRecord } from '../../types';

const record = (
  overrides: Partial<SavedManualActivityRecord> & { id: string },
): SavedManualActivityRecord => ({
  locationId: 'loc-1',
  locationName: '東京本社',
  energyType: 'electricity',
  amount: 1000,
  unit: 'kWh',
  periodStart: '2025-04-01',
  periodEnd: '2025-04-30',
  note: null,
  createdAt: '2025-05-01T09:00:00+09:00',
  emissionFactorId: null,
  emissions: 0.438,
  appliedFactorName: '電気 (株)テスト電力 メニューA（基礎）',
  appliedFactorValue: 0.000438,
  appliedFactorUnit: 't-CO2e/kWh',
  scope3CategoryId: null,
  ideaFactorId: null,
  ideaProductName: null,
  ...overrides,
});

describe('toHistoryItem の適用係数表示', () => {
  it('算定済みレコードは係数名と「値 単位」の表示文字列を持つ', () => {
    const item = toHistoryItem(record({ id: 'rec-1' }));

    expect(item.appliedFactorName).toBe('電気 (株)テスト電力 メニューA（基礎）');
    expect(item.appliedFactorValueText).toBe('0.000438 t-CO2e/kWh');
  });

  it('未算定レコードは係数名・値表示とも null になる', () => {
    const item = toHistoryItem(
      record({
        id: 'rec-2',
        emissions: null,
        appliedFactorName: null,
        appliedFactorValue: null,
        appliedFactorUnit: null,
      }),
    );

    expect(item.appliedFactorName).toBeNull();
    expect(item.appliedFactorValueText).toBeNull();
  });

  it('単位スナップショットが欠けていても値だけで表示できる', () => {
    const item = toHistoryItem(record({ id: 'rec-3', appliedFactorUnit: null }));

    expect(item.appliedFactorValueText).toBe('0.000438');
  });
});

describe('適用係数のキーワード検索', () => {
  const items = [
    toHistoryItem(record({ id: 'rec-1' })),
    toHistoryItem(
      record({
        id: 'rec-2',
        emissions: null,
        appliedFactorName: null,
        appliedFactorValue: null,
        appliedFactorUnit: null,
      }),
    ),
  ];

  it.each([
    ['事業者名', 'テスト電力'],
    ['係数名の一部', 'メニューA'],
    ['係数値', '0.000438'],
  ])('%s（%s）で該当行だけに絞り込める', (_label, searchQuery) => {
    const filtered = filterActivityHistory(items, {
      ...DEFAULT_HISTORY_FILTERS,
      searchQuery,
    });

    expect(filtered.map((item) => item.id)).toEqual(['rec-1']);
  });
});
