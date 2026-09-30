// 十進表記の数値文字列（SsbjDecimalString）の検証。
// 排出量などは DB の numeric を桁落ちさせないよう文字列で受け渡す（docs/ssbj-spec.md §6）。
// 指数表記（1e3）・桁区切りのカンマ・全角数字・前後の空白は、保存版や CSV で解釈が揺れるため認めない。

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

export const isDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && DECIMAL_STRING_PATTERN.test(value);

/**
 * 表示用に整数部へ 3 桁ごとのカンマを入れる（例 "12345.6" → "12,345.6"）。丸めず、小数部はそのまま残す。
 * 保存版・CSV には使わない（受け渡しは isDecimalString の形のまま）。
 */
export const formatDecimalForDisplay = (value: string): string => {
  const [integer, fraction] = value.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
};
