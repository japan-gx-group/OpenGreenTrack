// 請求書の需要場所の住所から、拠点の候補を選ぶ（純関数・副作用なし）。拠点の一覧は AI に送らない。
//
// 住所は書き方の違いが大きいため、比べる前にそろえる: 全角・半角、空白、郵便番号、ハイフンの種類、
// 「1丁目2番3号」と「1-2-3」、漢数字の丁目（「一丁目」）。そろえた住所の先頭からの一致の長さで比べ、
// 番地まで（短いほうの 8 割以上）一致した拠点のうち、いちばん長く一致したものを選ぶ。同じ長さで並べば決めない。

export interface LocationAddressOption {
  id: string;
  name: string;
  address: string | null;
}

const KANJI_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「十二」「二十三」などの漢数字（1〜99）を数字にする。読めなければ null */
const kanjiToNumber = (text: string): number | null => {
  if (/^[一二三四五六七八九]$/.test(text)) return KANJI_DIGITS[text];
  const match = /^([二三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(text);
  if (!match) return null;
  return (match[1] ? KANJI_DIGITS[match[1]] : 1) * 10 + (match[2] ? KANJI_DIGITS[match[2]] : 0);
};

/** 比べるための住所。空なら '' */
export const normalizeAddress = (address: string): string =>
  address
    .normalize('NFKC')
    .replace(/〒?\s*\d{3}-?\d{4}/g, '')
    .replace(/\s/g, '')
    .replace(/[‐‑‒–—―ー−－]/g, (char, offset: number, whole: string) =>
      // 長音記号（ー）は、数字のあとにあるときだけハイフンとみなす（「センター」などを崩さない）
      char === 'ー' && !/\d/.test(whole[offset - 1] ?? '') ? char : '-',
    )
    .replace(/([一二三四五六七八九十]+)丁目/g, (whole, kanji: string) => {
      const number = kanjiToNumber(kanji);
      return number === null ? whole : `${number}丁目`;
    })
    .replace(/(\d+)丁目/g, '$1-')
    .replace(/(\d+)番地?/g, '$1-')
    .replace(/(\d+)号/g, '$1')
    .replace(/-+/g, '-')
    .replace(/-$/, '');

const commonPrefixLength = (a: string, b: string): number => {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
};

/** 一致とみなす、短いほうの住所に対する先頭からの一致の割合 */
const MIN_MATCH_RATIO = 0.8;
/** 一致とみなす最短の長さ（都道府県名だけの一致などを拾わないため） */
const MIN_MATCH_LENGTH = 8;

/** 住所が一致する拠点。決められなければ null */
export const matchLocationByAddress = (
  supplyAddress: string | null,
  locations: readonly LocationAddressOption[],
): { id: string; name: string } | null => {
  if (!supplyAddress) return null;
  const target = normalizeAddress(supplyAddress);
  if (target.length < MIN_MATCH_LENGTH) return null;

  let best: { location: LocationAddressOption; length: number } | null = null;
  let tied = false;
  for (const location of locations) {
    if (!location.address) continue;
    const candidate = normalizeAddress(location.address);
    const length = commonPrefixLength(target, candidate);
    const shorter = Math.min(target.length, candidate.length);
    if (length < MIN_MATCH_LENGTH || length < shorter * MIN_MATCH_RATIO) continue;
    if (!best || length > best.length) {
      best = { location, length };
      tied = false;
    } else if (length === best.length) {
      tied = true;
    }
  }
  return best && !tied ? { id: best.location.id, name: best.location.name } : null;
};
