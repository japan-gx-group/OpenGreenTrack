import { describe, expect, it } from 'vitest';
import {
  filterSamePeriod,
  groupPeriodsByStartYear,
  orderCandidatesFromAnchor,
  type FiscalYearLookupRow,
} from '../fiscalYearLookup';

const row = (
  id: string,
  startDate: string,
  endDate: string,
): FiscalYearLookupRow => ({
  id,
  label: `${startDate.slice(0, 4)}年度`,
  startDate,
  endDate,
  organizationId: 'org-1',
});

describe('orderCandidatesFromAnchor', () => {
  it('選択中の年度行を先頭に固定し、重複させない', () => {
    const anchor = row('own', '2026-07-01', '2027-06-30');
    const rows = [row('group', '2026-07-01', '2027-06-30'), anchor];

    expect(orderCandidatesFromAnchor(anchor, rows).map(candidate => candidate.id)).toEqual([
      'own',
      'group',
    ]);
  });
});

describe('filterSamePeriod', () => {
  it('同じ暦年でも期間が違う年度行は候補から外す', () => {
    const anchor = row('anchor', '2026-07-01', '2027-06-30');
    const rows = [
      anchor,
      row('same-period', '2026-07-01', '2027-06-30'),
      // 期首月を変える前に登録された同じ年の年度行
      row('other-period', '2026-04-01', '2027-03-31'),
    ];

    expect(filterSamePeriod(anchor, rows).map(candidate => candidate.id)).toEqual([
      'anchor',
      'same-period',
    ]);
  });
});

describe('groupPeriodsByStartYear', () => {
  it('開始日の暦年ごとに期間をまとめる', () => {
    const periods = groupPeriodsByStartYear([
      row('2024', '2024-04-01', '2025-03-31'),
      row('2025', '2025-04-01', '2026-03-31'),
    ]);

    expect(periods.get(2024)).toEqual({ startDate: '2024-04-01', endDate: '2025-03-31' });
    expect(periods.get(2025)).toEqual({ startDate: '2025-04-01', endDate: '2026-03-31' });
  });

  it('期首月が一致する年度行（グループ会社の別期首月より自組織の年度）を優先する', () => {
    const periods = groupPeriodsByStartYear(
      [
        // 先に並んでいても期首月が違う行は採用しない
        row('group-company', '2024-04-01', '2025-03-31'),
        row('own', '2024-07-01', '2025-06-30'),
      ],
      7,
    );

    expect(periods.get(2024)).toEqual({ startDate: '2024-07-01', endDate: '2025-06-30' });
  });

  it('期首月が一致する行が無ければ暦年で最初に見つかった期間を使う', () => {
    const periods = groupPeriodsByStartYear([row('only', '2024-04-01', '2025-03-31')], 7);

    expect(periods.get(2024)).toEqual({ startDate: '2024-04-01', endDate: '2025-03-31' });
  });
});
