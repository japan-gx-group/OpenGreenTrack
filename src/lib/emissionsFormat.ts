// 排出量（t-CO2e）の数値を画面に出すときの共通フォーマッタ。
// 画面ごとに Intl.NumberFormat を持つと桁がそろわないため、表示ルールをここに集約する。
// 表示だけを変えるものであり、DB や算定の値は変更しない。

export type EmissionsPrecision = 'summary' | 'detail';

// summary の境界。この値未満（小数1桁に丸めた後）は小数1桁、以上は整数で表示する。
const SUMMARY_DECIMAL_THRESHOLD = 100;

// detail: 精度が意味を持つ出力（レポートの表・データ入力の算定結果など）向け。小数3位まで。
const detailFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
// summary: KPI カードなどの要約向け。
const oneDecimalFormatter = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const integerFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

/**
 * 排出量の数値をカンマ区切りの文字列にする（単位は付けない）。
 *
 * - `summary`（既定）: 整数。ただし絶対値が 100 未満なら小数1桁（小規模な組織で値が 0 に潰れないようにする）。
 *   小数1桁に丸めても 0 になる値は `0` と表示する。
 * - `detail`: 小数3位まで（末尾のゼロは出さない）。
 *
 * null や「未算定」の扱いは呼び出し側で行う。
 */
export const formatEmissionsNumber = (
  value: number,
  options?: { precision?: EmissionsPrecision },
): string => {
  if (options?.precision === 'detail') {
    return detailFormatter.format(value);
  }

  // 閾値の判定は丸めた後の値で行う（99.96 が「100.0」と表示されないようにする）。
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  if (rounded === 0) {
    return '0';
  }
  if (rounded < SUMMARY_DECIMAL_THRESHOLD) {
    return oneDecimalFormatter.format(value);
  }
  return integerFormatter.format(value);
};
