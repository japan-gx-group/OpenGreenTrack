// 排出量グラフ（Y軸・ツールチップ）の表示用フォーマッタ。ダッシュボードの排出量推移グラフと拠点詳細の月別グラフで共有する。
// 表示規則そのものは共通フォーマッタ formatEmissionsNumber に置き、ここではグラフのどこにどちらの精度を使うかだけを決める。
import { formatEmissionsNumber } from '@/lib/emissionsFormat';

/**
 * Y軸の目盛り。目盛り値はグラフ側がきりのよい数に揃えるため、詳細表示（小数3位まで・末尾のゼロなし）でカンマ区切りだけを付ける。
 * 要約表示にすると、小さな目盛り（0.02 / 0.04）がどれも「<0.1」になって区別できず、100 未満の目盛りが「25.0」になるため使わない。
 */
export const formatEmissionsAxisTick = (value: number): string =>
  formatEmissionsNumber(value, { precision: 'detail' });

/**
 * ツールチップの値。KPI カード・Scope 別カードと同じ要約表示にして、同じ画面で桁がずれないようにする。
 * ダッシュボードの前年度ラインは未記録の月を null で持つため、null は「データなし」と明示する。
 */
export const formatEmissionsTooltipValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'データなし';
  }
  if (typeof value === 'number') {
    return formatEmissionsNumber(value);
  }
  return String(value);
};
