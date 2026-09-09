import { describe, expect, it } from 'vitest';
import {
  buildDashboardMonthlyData,
  buildDashboardSummary,
  buildLocationDashboardData,
  buildLocationYearlyEmissionData,
  buildPreviousYearMonthlyTotals,
  buildScope3PieData,
  buildTopLocationDetails,
  buildYearlyEmissionData,
  sumFallbackFiscalYearTotal,
  sumScope3CategoryEmissions,
  type FiscalYearAggregateRow,
  type FiscalYearBucket,
  type LocationScopeEmissionRow,
  type MonthlyEmissionRow,
  type Scope3CategoryEmissionRow,
} from '../dashboardAggregation';

// 年度別グラフ用の年度一覧（新しい順で渡しても古い順に並ぶことを確かめるため降順で持つ）。
const fiscalYearBuckets: FiscalYearBucket[] = [
  { id: 'fy-2025', label: '2025年度', startDate: '2025-04-01', endDate: '2026-03-31' },
  { id: 'fy-2024', label: '2024年度', startDate: '2024-04-01', endDate: '2025-03-31' },
];

describe('buildYearlyEmissionData', () => {
  it('年度を古い順に並べ、dashboard_aggregates の確定値を Scope 別に載せる', () => {
    const rows: FiscalYearAggregateRow[] = [
      { fiscalYearId: 'fy-2024', scope1Total: 10, scope2Total: '20', scope3Total: 30 },
      { fiscalYearId: 'fy-2025', scope1Total: 11, scope2Total: 21, scope3Total: 31 },
    ];

    expect(buildYearlyEmissionData(fiscalYearBuckets, rows)).toEqual([
      { fiscalYearId: 'fy-2024', year: 2024, name: '2024年度', scope1: 10, scope2: 20, scope3: 30 },
      { fiscalYearId: 'fy-2025', year: 2025, name: '2025年度', scope1: 11, scope2: 21, scope3: 31 },
    ]);
  });

  it('集計行が無い年度は0で埋めて並べる（未算定の年度も横並びで見えるようにする）', () => {
    const points = buildYearlyEmissionData(fiscalYearBuckets, [
      { fiscalYearId: 'fy-2025', scope1Total: 1, scope2Total: 2, scope3Total: 3 },
    ]);

    expect(points[0]).toEqual({
      fiscalYearId: 'fy-2024',
      year: 2024,
      name: '2024年度',
      scope1: 0,
      scope2: 0,
      scope3: 0,
    });
  });
});

describe('buildLocationYearlyEmissionData', () => {
  it('月別集計行を年度期間へ振り分けて Scope 1・2 を合計する（Scope 3 は常に0）', () => {
    const rows: MonthlyEmissionRow[] = [
      { monthStart: '2024-04-01', scope: 'scope1', emissions: 10 },
      { monthStart: '2025-03-01', scope: 'scope2', emissions: '5' },
      { monthStart: '2025-04-01', scope: 'scope1', emissions: 7 },
      // 年度一覧に無い期間の行は、どの年度にも足さない。
      { monthStart: '2023-04-01', scope: 'scope1', emissions: 99 },
    ];

    expect(buildLocationYearlyEmissionData(fiscalYearBuckets, rows)).toEqual([
      { fiscalYearId: 'fy-2024', year: 2024, name: '2024年度', scope1: 10, scope2: 5, scope3: 0 },
      { fiscalYearId: 'fy-2025', year: 2025, name: '2025年度', scope1: 7, scope2: 0, scope3: 0 },
    ]);
  });
});

describe('buildDashboardMonthlyData', () => {
  const currentRows: MonthlyEmissionRow[] = [
    { monthStart: '2024-04-01', scope: 'scope1', emissions: 10 },
    { monthStart: '2024-04-01', scope: 'scope2', emissions: '20' },
    { monthStart: '2024-05-01', scope: 'scope1', emissions: 5 },
    { monthStart: '2025-03-01', scope: 'scope3', emissions: 7 },
  ];

  it('月別×Scope の集計行を12ヶ月の積み上げ系列へ振り分ける', () => {
    const data = buildDashboardMonthlyData(currentRows, []);

    expect(data).toHaveLength(12);
    expect(data[0]).toEqual({ name: '4月', scope1: 10, scope2: 20, scope3: 0, previousYearTotal: null });
    expect(data[1]).toEqual({ name: '5月', scope1: 5, scope2: 0, scope3: 0, previousYearTotal: null });
    expect(data[11]).toEqual({ name: '3月', scope1: 0, scope2: 0, scope3: 7, previousYearTotal: null });
  });

  it('前年度の集計行がある場合は Scope 1+2+3 の月別合計を昨年度ラインへ載せる', () => {
    const previousRows: MonthlyEmissionRow[] = [
      { monthStart: '2023-04-01', scope: 'scope1', emissions: 12 },
      { monthStart: '2023-04-01', scope: 'scope2', emissions: '8' },
      { monthStart: '2023-04-01', scope: 'scope3', emissions: 100 },
      { monthStart: '2024-01-01', scope: 'scope2', emissions: 3 },
    ];
    const data = buildDashboardMonthlyData(currentRows, previousRows);

    expect(data[0].previousYearTotal).toBe(120); // 4月: 12 + 8 + 100
    expect(data[9].previousYearTotal).toBe(3); // 1月
    // 前年度のレコードが無い月は「未記録」なので 0 ではなく null（線を途切れさせる）。
    expect(data[1].previousYearTotal).toBeNull();
  });

  it('前年度が年度途中からしか無い場合、レコードの無い月だけ null にする', () => {
    // 2025年10月に利用開始した組織の前年度: 4〜9月は未記録、10〜3月は記録あり。
    const previousRows: MonthlyEmissionRow[] = [
      { monthStart: '2023-10-01', scope: 'scope1', emissions: 10 },
      { monthStart: '2023-11-01', scope: 'scope1', emissions: 11 },
      { monthStart: '2023-12-01', scope: 'scope2', emissions: 12 },
      { monthStart: '2024-01-01', scope: 'scope1', emissions: 13 },
      { monthStart: '2024-02-01', scope: 'scope3', emissions: 14 },
      { monthStart: '2024-03-01', scope: 'scope1', emissions: 15 },
    ];
    const data = buildDashboardMonthlyData(currentRows, previousRows);

    expect(data.slice(0, 6).map(point => point.previousYearTotal)).toEqual([
      null, null, null, null, null, null,
    ]);
    expect(data.slice(6).map(point => point.previousYearTotal)).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it('前年度に排出0のレコードがある月は null ではなく 0 のまま描く', () => {
    const previousRows: MonthlyEmissionRow[] = [
      { monthStart: '2023-04-01', scope: 'scope1', emissions: 0 },
      { monthStart: '2023-05-01', scope: 'scope2', emissions: '0' },
    ];
    const data = buildDashboardMonthlyData(currentRows, previousRows);

    expect(data[0].previousYearTotal).toBe(0);
    expect(data[1].previousYearTotal).toBe(0);
    expect(data[2].previousYearTotal).toBeNull();
  });

  it('前年度の集計行が無い場合は昨年度ラインを全月 null にする（系列非表示用）', () => {
    const data = buildDashboardMonthlyData(currentRows, []);

    expect(data.every(point => point.previousYearTotal === null)).toBe(true);
  });

  it('7月始まりの会社では月別ラベルと集計位置を7月開始にする', () => {
    const rows: MonthlyEmissionRow[] = [
      { monthStart: '2024-07-01', scope: 'scope1', emissions: 10 },
      { monthStart: '2025-06-01', scope: 'scope2', emissions: 20 },
    ];
    const data = buildDashboardMonthlyData(rows, [], 7);

    expect(data[0]).toEqual({ name: '7月', scope1: 10, scope2: 0, scope3: 0, previousYearTotal: null });
    expect(data[11]).toEqual({ name: '6月', scope1: 0, scope2: 20, scope3: 0, previousYearTotal: null });
  });
});

describe('buildPreviousYearMonthlyTotals', () => {
  const rows: MonthlyEmissionRow[] = [
    { monthStart: '2023-04-01', scope: 'scope1', emissions: 10 },
    { monthStart: '2023-04-01', scope: 'scope2', emissions: '5' },
    { monthStart: '2023-04-01', scope: 'scope3', emissions: 100 },
    { monthStart: '2024-01-01', scope: 'scope2', emissions: 7 },
  ];

  it('includeScope3: true で Scope 1+2+3 の月別合計を返す（組織全体チャート用）', () => {
    const totals = buildPreviousYearMonthlyTotals(rows, { includeScope3: true });

    expect(totals).toHaveLength(12);
    expect(totals?.[0]).toBe(115); // 4月: 10 + 5 + 100
    expect(totals?.[9]).toBe(7); // 1月
    expect(totals?.[1]).toBeNull(); // レコードが無い月は未記録として null
  });

  it('Scope 3 しか無い月を includeScope3: false で見た場合はその月だけ null になる', () => {
    const mixed: MonthlyEmissionRow[] = [
      { monthStart: '2023-04-01', scope: 'scope1', emissions: 10 },
      { monthStart: '2023-05-01', scope: 'scope3', emissions: 100 },
    ];
    const totals = buildPreviousYearMonthlyTotals(mixed, { includeScope3: false });

    expect(totals?.[0]).toBe(10);
    // 拠点絞り込みでは Scope 3 を除外するため、5月は集計対象の行が無い＝未記録扱い。
    expect(totals?.[1]).toBeNull();
  });

  it('排出0のレコードがある月は 0 のまま（null にしない）', () => {
    const zero: MonthlyEmissionRow[] = [
      { monthStart: '2023-04-01', scope: 'scope1', emissions: 0 },
    ];
    const totals = buildPreviousYearMonthlyTotals(zero, { includeScope3: true });

    expect(totals?.[0]).toBe(0);
    expect(totals?.[1]).toBeNull();
  });

  it('includeScope3: false で Scope 3 を除外する（拠点絞り込みチャート用）', () => {
    const totals = buildPreviousYearMonthlyTotals(rows, { includeScope3: false });

    expect(totals?.[0]).toBe(15); // 4月: 10 + 5
    expect(totals?.[9]).toBe(7);
  });

  it('集計対象の行が1件も無い場合は null を返す（系列非表示用）', () => {
    expect(buildPreviousYearMonthlyTotals([], { includeScope3: true })).toBeNull();
    // Scope 3 しか無い拠点データを includeScope3: false で見た場合も「データなし」扱い。
    const scope3Only: MonthlyEmissionRow[] = [
      { monthStart: '2023-04-01', scope: 'scope3', emissions: 100 },
    ];
    expect(buildPreviousYearMonthlyTotals(scope3Only, { includeScope3: false })).toBeNull();
  });

  it('月として解釈できない行は集計から除外する', () => {
    const invalid: MonthlyEmissionRow[] = [
      { monthStart: 'invalid', scope: 'scope1', emissions: 100 },
    ];
    expect(buildPreviousYearMonthlyTotals(invalid, { includeScope3: true })).toBeNull();
  });
});

describe('buildLocationDashboardData', () => {
  const currentRows: MonthlyEmissionRow[] = [
    { monthStart: '2024-04-01', scope: 'scope1', emissions: 10 },
    { monthStart: '2024-04-01', scope: 'scope2', emissions: '20' },
    { monthStart: '2024-05-01', scope: 'scope1', emissions: 5 },
    { monthStart: '2025-03-01', scope: 'scope2', emissions: 7 },
  ];

  it('Scope 1/2 の合計と月別内訳を組み立てる', () => {
    const data = buildLocationDashboardData(currentRows, []);

    expect(data.scope1Total).toBe(15);
    expect(data.scope2Total).toBe(27);
    expect(data.combinedTotal).toBe(42);
    expect(data.monthlyData).toHaveLength(12);
    expect(data.monthlyData[0]).toEqual({ name: '4月', scope1: 10, scope2: 20, previousYearTotal: null });
    expect(data.monthlyData[1]).toEqual({ name: '5月', scope1: 5, scope2: 0, previousYearTotal: null });
    expect(data.monthlyData[11]).toEqual({ name: '3月', scope1: 0, scope2: 7, previousYearTotal: null });
  });

  it('Scope 3 の集計行は合計・月別のどちらにも含めない（組織・年度単位のみのため）', () => {
    const withScope3: MonthlyEmissionRow[] = [
      ...currentRows,
      { monthStart: '2024-04-01', scope: 'scope3', emissions: 999 },
    ];
    const data = buildLocationDashboardData(withScope3, []);

    expect(data.combinedTotal).toBe(42);
    expect(data.monthlyData[0]).toEqual({ name: '4月', scope1: 10, scope2: 20, previousYearTotal: null });
  });

  it('前年データがある場合は前年比を計算する', () => {
    const previousRows: MonthlyEmissionRow[] = [
      { monthStart: '2023-04-01', scope: 'scope1', emissions: 30 },
      { monthStart: '2023-04-01', scope: 'scope2', emissions: 30 },
    ];
    const data = buildLocationDashboardData(currentRows, previousRows);

    expect(data.scope1DiffPercent).toBeCloseTo(-50); // 15 vs 30
    expect(data.scope2DiffPercent).toBeCloseTo(-10); // 27 vs 30
    expect(data.totalDiffPercent).toBeCloseTo(-30); // 42 vs 60
  });

  it('前年データがある場合は月別の昨年度合計（Scope 1+2）を組み立てる', () => {
    const previousRows: MonthlyEmissionRow[] = [
      { monthStart: '2023-04-01', scope: 'scope1', emissions: 12 },
      { monthStart: '2023-04-01', scope: 'scope2', emissions: '8' },
      // Scope 3 は拠点単位で持てないため、当年度バーと同様に昨年度ラインからも除外される。
      { monthStart: '2023-04-01', scope: 'scope3', emissions: 999 },
      { monthStart: '2024-03-01', scope: 'scope2', emissions: 3 },
    ];
    const data = buildLocationDashboardData(currentRows, previousRows);

    expect(data.monthlyData[0].previousYearTotal).toBe(20); // 4月: 12 + 8
    expect(data.monthlyData[11].previousYearTotal).toBe(3); // 3月
    // 前年度のレコードが無い月は「未記録」なので 0 ではなく null（線を途切れさせる）。
    expect(data.monthlyData[1].previousYearTotal).toBeNull();
  });

  it('7月始まりの会社では月別ラベルと集計位置を7月開始にする', () => {
    const rows: MonthlyEmissionRow[] = [
      { monthStart: '2024-07-01', scope: 'scope1', emissions: 10 },
      { monthStart: '2025-06-01', scope: 'scope2', emissions: 20 },
    ];
    const data = buildLocationDashboardData(rows, [], { fiscalYearStartMonth: 7 });

    expect(data.monthlyData[0]).toEqual({ name: '7月', scope1: 10, scope2: 0, previousYearTotal: null });
    expect(data.monthlyData[11]).toEqual({ name: '6月', scope1: 0, scope2: 20, previousYearTotal: null });
  });

  it('前年データが無い場合は前年比が null になる', () => {
    const data = buildLocationDashboardData(currentRows, []);

    expect(data.scope1DiffPercent).toBeNull();
    expect(data.scope2DiffPercent).toBeNull();
    expect(data.totalDiffPercent).toBeNull();
    expect(data.monthlyData.every(point => point.previousYearTotal === null)).toBe(true);
  });

  it('空データの拠点でも0値で破綻しない', () => {
    const data = buildLocationDashboardData([], []);

    expect(data.scope1Total).toBe(0);
    expect(data.scope2Total).toBe(0);
    expect(data.combinedTotal).toBe(0);
    expect(data.totalDiffPercent).toBeNull();
    expect(data.monthlyData).toHaveLength(12);
  });
});

describe('buildTopLocationDetails', () => {
  const row = (
    locationId: string,
    name: string | null,
    scope: 'scope1' | 'scope2',
    emissions: number | string,
  ): LocationScopeEmissionRow => ({
    locationId,
    name,
    region: 'kanto',
    type: 'factory',
    scope,
    emissions,
  });

  const currentRows: LocationScopeEmissionRow[] = [
    row('loc-a', '本社', 'scope1', 40),
    row('loc-a', '本社', 'scope2', '60'),
    row('loc-b', '大阪工場', 'scope1', 30),
    row('loc-b', '大阪工場', 'scope2', 20),
    row('loc-c', '名古屋支店', 'scope1', 25),
  ];

  it('拠点ごとに Scope 1・2 を合算し、合計の降順に並べる', () => {
    const rows = buildTopLocationDetails(currentRows, []);

    expect(rows.map(entry => entry.locationId)).toEqual(['loc-a', 'loc-b', 'loc-c']);
    expect(rows[0]).toMatchObject({ name: '本社', scope1: 40, scope2: 60, total: 100 });
    expect(rows[1]).toMatchObject({ scope1: 30, scope2: 20, total: 50 });
    // Scope 2 の行が無い拠点は 0 として扱う。
    expect(rows[2]).toMatchObject({ scope1: 25, scope2: 0, total: 25 });
  });

  it('前年度の同拠点の合計から前年比を出し、前年データが無い拠点は null にする', () => {
    const previousRows: LocationScopeEmissionRow[] = [
      row('loc-a', '本社', 'scope1', 50),
      row('loc-a', '本社', 'scope2', 50),
    ];
    const rows = buildTopLocationDetails(currentRows, previousRows);

    // 100 → 100 なので増減なし。
    expect(rows[0].diffPercent).toBe(0);
    expect(rows[1].diffPercent).toBeNull();
  });

  it('RPC の並び順に依存せず降順へ並べ替え、既定で上位5拠点までに絞る', () => {
    const many = [10, 60, 30, 40, 50, 20].map((value, index) =>
      row(`loc-${index + 1}`, `拠点${index + 1}`, 'scope1', value),
    );
    const rows = buildTopLocationDetails(many, []);

    expect(rows).toHaveLength(5);
    expect(rows.map(entry => entry.locationId)).toEqual([
      'loc-2', 'loc-5', 'loc-4', 'loc-3', 'loc-6',
    ]);
  });

  it('拠点名が null（RLS で不可視など）の場合はフォールバック名を表示する', () => {
    const rows = buildTopLocationDetails([row('loc-x', null, 'scope1', 10)], []);

    expect(rows[0].name).toBe('名称未設定の拠点');
  });

  it('空データでも破綻しない', () => {
    expect(buildTopLocationDetails([], [])).toEqual([]);
  });
});

describe('buildScope3PieData', () => {
  it('採用値の合計を分母に構成比を出す（合計は scope3Total と一致する前提）', () => {
    const rows: Scope3CategoryEmissionRow[] = [
      { categoryId: 1, emissions: 60 },
      // supabase-js は numeric を string で返すことがある
      { categoryId: 4, emissions: '30' },
      { categoryId: 5, emissions: 10 },
    ];

    const items = buildScope3PieData(rows);

    expect(items.map(item => item.value)).toEqual([60, 30, 10]);
    expect(items.map(item => item.percent)).toEqual([60, 30, 10]);
    expect(items.reduce((sum, item) => sum + item.value, 0)).toBe(100);
    expect(items[0].name).toBe('カテゴリ1: 購入した製品・サービス');
  });

  it('未知のカテゴリ番号は番号だけのフォールバック名にする', () => {
    const items = buildScope3PieData([{ categoryId: 99, emissions: 5 }]);

    expect(items[0].name).toBe('カテゴリ99');
  });

  it('空データ・合計0では空配列を返す（0除算しない）', () => {
    expect(buildScope3PieData([])).toEqual([]);
    expect(buildScope3PieData([{ categoryId: 1, emissions: 0 }])).toEqual([]);
  });
});

describe('sumFallbackFiscalYearTotal', () => {
  it('Scope 1/2 は月別行から、Scope 3 はカテゴリ別採用値から合算する', () => {
    const monthly: MonthlyEmissionRow[] = [
      { monthStart: '2025-04-01', scope: 'scope1', emissions: 100 },
      { monthStart: '2025-04-01', scope: 'scope2', emissions: '50.5' },
      { monthStart: '2025-05-01', scope: 'scope1', emissions: 10 },
    ];
    const scope3: Scope3CategoryEmissionRow[] = [
      { categoryId: 1, emissions: '200' },
      { categoryId: 6, emissions: 30 },
    ];

    expect(sumFallbackFiscalYearTotal(monthly, scope3)).toBe(390.5);
  });

  it('月別行の Scope 3 は無視する（直接入力分が無く、採用値 RPC と二重計上になるため）', () => {
    const monthly: MonthlyEmissionRow[] = [
      { monthStart: '2025-04-01', scope: 'scope1', emissions: 100 },
      { monthStart: '2025-04-01', scope: 'scope3', emissions: 999 },
    ];

    expect(sumFallbackFiscalYearTotal(monthly, [{ categoryId: 1, emissions: 25 }])).toBe(125);
  });

  it('どちらも空なら 0', () => {
    expect(sumFallbackFiscalYearTotal([], [])).toBe(0);
  });
});

describe('buildDashboardSummary', () => {
  const currentAggregate: FiscalYearAggregateRow = {
    fiscalYearId: 'fy-2025',
    scope1Total: '100',
    scope2Total: 50,
    scope3Total: 0,
  };
  const previousAggregate: FiscalYearAggregateRow = {
    fiscalYearId: 'fy-2024',
    scope1Total: 80,
    scope2Total: 40,
    scope3Total: 0,
  };
  const currentScope3Rows: Scope3CategoryEmissionRow[] = [
    { categoryId: 1, emissions: 60 },
    { categoryId: 6, emissions: '40' },
  ];
  const previousScope3Rows: Scope3CategoryEmissionRow[] = [{ categoryId: 1, emissions: 50 }];

  it('Scope 3 は集計行の scope3Total ではなく内訳と同じカテゴリ別採用値の合計を使う', () => {
    // 集計行の更新だけが失敗して scope3Total が 0 のままでも、内訳バーと同じ値になる
    const summary = buildDashboardSummary(currentAggregate, previousAggregate, currentScope3Rows, previousScope3Rows);

    expect(summary.find(item => item.title === 'Scope 3')?.value).toBe(100);
    expect(summary.find(item => item.title === 'Scope 3')?.value).toBe(sumScope3CategoryEmissions(currentScope3Rows));
  });

  it('総排出量も同じ Scope 3 値で合算し、Scope 1/2 は集計行の値を使う', () => {
    const summary = buildDashboardSummary(currentAggregate, previousAggregate, currentScope3Rows, previousScope3Rows);

    expect(summary.map(item => [item.title, item.value])).toEqual([
      ['総排出量', 250],
      ['Scope 1', 100],
      ['Scope 2', 50],
      ['Scope 3', 100],
    ]);
  });

  it('前年比は Scope 3 も前年度の採用値合計と比べる', () => {
    const summary = buildDashboardSummary(currentAggregate, previousAggregate, currentScope3Rows, previousScope3Rows);

    expect(summary.find(item => item.title === 'Scope 3')?.diffPercent).toBe(100);
    expect(summary.find(item => item.title === 'Scope 1')?.diffPercent).toBe(25);
    // 総排出量: (250 - 170) / 170
    expect(summary.find(item => item.title === '総排出量')?.diffPercent).toBeCloseTo((80 / 170) * 100);
  });

  it('集計行が無い年度でも常に4項目を返し、Scope 3 は採用値から出す（前年度が無ければ前年比 null）', () => {
    const summary = buildDashboardSummary(null, null, currentScope3Rows, []);

    expect(summary.map(item => [item.title, item.value, item.diffPercent])).toEqual([
      ['総排出量', 100, null],
      ['Scope 1', 0, null],
      ['Scope 2', 0, null],
      ['Scope 3', 100, null],
    ]);
  });
});
