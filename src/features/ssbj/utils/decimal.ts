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

/** 十進文字列を、小数部の桁数をそろえた BigInt にする（例 "12.5", 3 → 12500n）。 */
const toScaledBigInt = (value: string, scale: number): bigint => {
  const negative = value.startsWith('-');
  const [integer, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = BigInt(integer + fraction.padEnd(scale, '0'));
  return negative ? -scaled : scaled;
};

/**
 * 十進文字列どうしの差（a − b）を、丸めずに十進文字列で返す（例 "100.5" − "120.25" → "-19.75"）。
 * number に変換すると桁落ちするため BigInt で計算する（docs/ssbj-spec.md §6）。末尾の 0 は落とす。
 */
export const subtractDecimalStrings = (a: string, b: string): string => {
  if (!isDecimalString(a) || !isDecimalString(b)) throw new Error('十進表記の数値ではありません');
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const diff = toScaledBigInt(a, scale) - toScaledBigInt(b, scale);
  const negative = diff < BigInt(0);
  const digits = (negative ? -diff : diff).toString().padStart(scale + 1, '0');
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
};
