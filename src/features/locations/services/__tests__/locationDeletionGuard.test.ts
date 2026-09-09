import { describe, expect, it } from 'vitest';
import {
  canDeleteLocation,
  formatImpactPeriod,
  formatMonthJa,
  type LocationDeletionImpact,
} from '../locationDeletionGuard';

const impact = (overrides: Partial<LocationDeletionImpact>): LocationDeletionImpact => ({
  activityRecordCount: 0,
  emissionResultCount: 0,
  uncalculatedCount: 0,
  periodFrom: null,
  periodTo: null,
  ...overrides,
});

describe('canDeleteLocation', () => {
  it('未算定の活動量データがなければ削除を許可する（true）', () => {
    expect(canDeleteLocation(impact({ activityRecordCount: 12, emissionResultCount: 12 }))).toBe(true);
  });

  it('未算定の活動量データが1件でもあれば削除を拒否する（false）', () => {
    expect(canDeleteLocation(impact({ activityRecordCount: 12, uncalculatedCount: 1 }))).toBe(false);
  });

  it('紐づくデータが1件もない拠点は削除を許可する（true）', () => {
    expect(canDeleteLocation(impact({}))).toBe(true);
  });
});

describe('formatMonthJa', () => {
  it('YYYY-MM-DD を「YYYY年M月」に整形する（月のゼロ埋めは外す）', () => {
    expect(formatMonthJa('2024-04-01')).toBe('2024年4月');
    expect(formatMonthJa('2025-12-31')).toBe('2025年12月');
  });

  it('想定外の形式はそのまま返して表示を壊さない', () => {
    expect(formatMonthJa('invalid')).toBe('invalid');
    expect(formatMonthJa('2024-13-01')).toBe('2024-13-01');
  });
});

describe('formatImpactPeriod', () => {
  it('開始月〜終了月を「YYYY年M月〜YYYY年M月」で返す', () => {
    expect(formatImpactPeriod({ periodFrom: '2024-04-01', periodTo: '2025-03-31' })).toBe(
      '2024年4月〜2025年3月',
    );
  });

  it('開始と終了が同じ月なら1つの月だけを返す', () => {
    expect(formatImpactPeriod({ periodFrom: '2024-04-01', periodTo: '2024-04-30' })).toBe('2024年4月');
  });

  it('期間が不明（データなし）なら null を返す', () => {
    expect(formatImpactPeriod({ periodFrom: null, periodTo: null })).toBeNull();
    expect(formatImpactPeriod({ periodFrom: '2024-04-01', periodTo: null })).toBeNull();
  });
});
