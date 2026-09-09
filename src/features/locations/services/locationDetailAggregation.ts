// 拠点別Scope内訳詳細画面の集計（純粋関数）。
// Supabase から取得した行データを受け取り、Scope別サマリー・月別推移・エネルギー種別内訳に変換する。
// locationDetailService（データ取得）とテストで共有するため、ここには I/O を置かない。
import type { EnergyType } from '@/features/calculation/types';
import { MANUAL_ACTIVITY_CATEGORY_MAP } from '@/features/data-input/types';
import {
  getMonthIndex,
  toNumber,
} from '@/features/dashboard/services/locationAggregation';
import {
  buildFiscalYearMonthLabels,
  normalizeFiscalYearStartMonth,
} from '@/lib/fiscal-year/fiscalYearPeriod';

export type DetailActivityRecord = {
  id: string;
  energyType: EnergyType;
  /** 活動量（numeric(15,3)）。supabase-js からは string で返ることがある */
  amount: number | string;
  unit: string;
  periodStart: string;
};

export type DetailEmissionResult = {
  activityRecordId: string | null;
  scope: 'scope1' | 'scope2' | 'scope3';
  emissions: number | string;
};

export type LocationScopeTotals = {
  scope1: number;
  scope2: number;
  scope3: number;
  total: number;
};

export type LocationDetailMonthlyPoint = {
  name: string;
  scope1: number;
  scope2: number;
  scope3: number;
};

export type EnergyBreakdownRow = {
  energyType: EnergyType;
  /** エネルギー種別の日本語ラベル（未知の種別はDB値をそのまま表示） */
  label: string;
  /** 単位ごとの活動量合計。通常は1種別=1単位だが、単位が混在しても情報を落とさない */
  amounts: { unit: string; amount: number }[];
  emissions: number;
  /** 拠点の総排出量に対する構成比（%）。総排出量が0のときは0 */
  percent: number;
};

export type LocationDetailData = {
  totals: LocationScopeTotals;
  monthlyData: LocationDetailMonthlyPoint[];
  energyBreakdown: EnergyBreakdownRow[];
  /** 活動量由来の Scope 3（emission_results の scope='scope3'）が存在するか */
  hasScope3: boolean;
  /** 当年度・当該拠点の活動量データが1件でもあるか（空状態表示の判定に使う） */
  hasData: boolean;
};

// エネルギー種別の日本語ラベル。データ入力機能の正本（MANUAL_ACTIVITY_CATEGORY_MAP）を再利用し、
// 未知の enum 値が来ても表示が壊れないよう DB 値をそのままフォールバックする。
export const getEnergyTypeLabel = (energyType: EnergyType): string =>
  MANUAL_ACTIVITY_CATEGORY_MAP[energyType]?.labelJP ?? energyType;

// 拠点詳細のサマリー・月別推移・エネルギー種別内訳を組み立てる。
// - activityRecords: 当年度・当該拠点の活動量レコード
// - emissionResults: それに紐づく排出結果
// NOTE: activityRecordId が null / 未知の排出結果は全集計から除外する。月・エネルギー種別への
// 振り分けができず、実運用でも取得が activityRecordId ベースのため紐づかない行は渡ってこない。
export const buildLocationDetailData = (
  activityRecords: DetailActivityRecord[],
  emissionResults: DetailEmissionResult[],
  options: { fiscalYearStartMonth?: number | null } = {},
): LocationDetailData => {
  const activityRecordById = new Map(activityRecords.map(record => [record.id, record]));
  const startMonth = normalizeFiscalYearStartMonth(options.fiscalYearStartMonth);
  const monthLabels = buildFiscalYearMonthLabels(startMonth);

  const totals: LocationScopeTotals = { scope1: 0, scope2: 0, scope3: 0, total: 0 };

  const monthlyData: LocationDetailMonthlyPoint[] = monthLabels.map(name => ({
    name,
    scope1: 0,
    scope2: 0,
    scope3: 0,
  }));

  // エネルギー種別ごとの中間集計。活動量は単位ごとに分けて合算する（単位混在で数値が壊れないように）。
  const breakdownByEnergyType = new Map<
    EnergyType,
    { amountsByUnit: Map<string, number>; emissions: number }
  >();

  const getBreakdownEntry = (energyType: EnergyType) => {
    let entry = breakdownByEnergyType.get(energyType);
    if (!entry) {
      entry = { amountsByUnit: new Map<string, number>(), emissions: 0 };
      breakdownByEnergyType.set(energyType, entry);
    }
    return entry;
  };

  // 活動量は排出結果の有無に関わらず表に出す（未算定のレコードも「排出量0」で見えるようにする）。
  activityRecords.forEach(record => {
    const entry = getBreakdownEntry(record.energyType);
    entry.amountsByUnit.set(
      record.unit,
      (entry.amountsByUnit.get(record.unit) ?? 0) + toNumber(record.amount),
    );
  });

  emissionResults.forEach(result => {
    if (!result.activityRecordId) return;
    const activityRecord = activityRecordById.get(result.activityRecordId);
    if (!activityRecord) return;

    const emissions = toNumber(result.emissions);
    totals[result.scope] += emissions;
    getBreakdownEntry(activityRecord.energyType).emissions += emissions;

    const monthIndex = getMonthIndex(activityRecord.periodStart, startMonth);
    if (monthIndex === null) return;
    monthlyData[monthIndex][result.scope] += emissions;
  });

  totals.total = totals.scope1 + totals.scope2 + totals.scope3;

  // 排出量の多い順に並べ、同値はラベル順で安定させる。
  const energyBreakdown: EnergyBreakdownRow[] = Array.from(breakdownByEnergyType.entries())
    .map(([energyType, entry]) => ({
      energyType,
      label: getEnergyTypeLabel(energyType),
      amounts: Array.from(entry.amountsByUnit.entries()).map(([unit, amount]) => ({ unit, amount })),
      emissions: entry.emissions,
      percent: totals.total > 0 ? (entry.emissions / totals.total) * 100 : 0,
    }))
    .sort((a, b) => b.emissions - a.emissions || a.label.localeCompare(b.label, 'ja'));

  return {
    totals,
    monthlyData,
    energyBreakdown,
    hasScope3: totals.scope3 > 0,
    hasData: activityRecords.length > 0,
  };
};
