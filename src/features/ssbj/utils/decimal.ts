// 十進表記の数値文字列（SsbjDecimalString）の検証。
// 排出量などは DB の numeric を桁落ちさせないよう文字列で受け渡す（docs/ssbj-spec.md §6）。
// 指数表記（1e3）・桁区切りのカンマ・全角数字・前後の空白は、保存版や CSV で解釈が揺れるため認めない。

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

export const isDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && DECIMAL_STRING_PATTERN.test(value);
