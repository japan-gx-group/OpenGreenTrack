// 排出量推移グラフ（Y軸・ツールチップ）の表示用フォーマッタ。
// ツールチップの表示規則は共通フォーマッタ formatEmissionsNumber に置き、ここではどちらの精度を使うかだけを決める。
// Y軸の目盛りだけは例外で、共通フォーマッタのどちらの精度も合わないためここで整形する（理由は下のコメント）。
import { formatEmissionsNumber } from '@/lib/emissionsFormat';

/**
 * Y軸の目盛り。目盛り値はグラフ側がきりのよい数に揃えるため、小数3位まで・末尾のゼロなしでカンマ区切りだけを付ける。
 * 詳細表示は小数3桁固定のため、目盛りには使わない。
 * 要約表示にすると、小さな目盛り（0.02 / 0.04）がどれも「<0.1」になって区別できず、100 未満の目盛りが「25.0」になるため使わない。
 */
export const formatEmissionsAxisTick = (value: number): string =>
  value.toLocaleString('ja-JP', { maximumFractionDigits: 3 });

/**
 * ツールチップの値。KPI カードと同じ要約表示にして、同じ画面で桁がずれないようにする。
 * 前年度ラインは未記録の月を null で持つため、null は「データなし」と明示する。
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
