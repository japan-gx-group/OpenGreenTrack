// ダッシュボード・拠点詳細・予測などの各サービスで共有する集計ヘルパー（純粋関数）。
// 数値変換・月インデックス・前年比といった基礎的な変換のみを置き、ここには I/O を置かない。
// NOTE: 月別×Scope の RPC 集計行 → グラフ系列への変換は dashboardAggregation.ts を参照。
// （従来ここにあった拠点絞り込みダッシュボードの集計は、集計を DB 側の RPC へ
//   移行したことに伴い dashboardAggregation.ts の RPC 行ベースの実装へ置き換えられた。）
import { getFiscalYearMonthIndex } from '@/lib/fiscal-year/fiscalYearPeriod';

export const toNumber = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

// 'YYYY-MM-DD' / 'YYYY-MM' の月から年度内インデックスを返す。
// 既定は従来どおり4月=0だが、会社の期首月を渡すと7月=0などに切り替わる。
export const getMonthIndex = (
  periodStart: string,
  fiscalYearStartMonth?: number | null,
): number | null => getFiscalYearMonthIndex(periodStart, fiscalYearStartMonth);

// 前年比（%）。前年が0（＝実質データなし）の場合は比較不能として null を返す。
export const calculateDiffPercent = (current: number, previous: number): number | null => {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
};
