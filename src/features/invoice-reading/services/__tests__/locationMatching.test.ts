import { describe, expect, it } from 'vitest';
import { matchLocationByAddress, normalizeAddress } from '../locationMatching';

const locations = [
  { id: 'tokyo', name: '東京本社', address: '東京都架空区架空町1-1-1' },
  { id: 'osaka', name: '大阪支社', address: '大阪府架空市架空町4-1-1' },
  { id: 'none', name: '住所なし', address: null },
];

describe('normalizeAddress', () => {
  it('郵便番号・空白・全角を除き、「1丁目2番3号」と「1-2-3」をそろえる', () => {
    expect(normalizeAddress('〒100-0000　東京都架空区架空町１丁目１番１号')).toBe('東京都架空区架空町1-1-1');
    expect(normalizeAddress('東京都架空区架空町1丁目1番地1')).toBe('東京都架空区架空町1-1-1');
  });

  it('漢数字の丁目と、ハイフンの書き方の違いをそろえる', () => {
    expect(normalizeAddress('東京都架空区架空町一丁目1−1')).toBe('東京都架空区架空町1-1-1');
    expect(normalizeAddress('東京都架空区架空町十二丁目3ー4')).toBe('東京都架空区架空町12-3-4');
  });

  it('数字の後ろでない長音記号は崩さない', () => {
    expect(normalizeAddress('架空市センター町1-1')).toBe('架空市センター町1-1');
  });
});

describe('matchLocationByAddress', () => {
  it('書き方の違う住所でも、番地まで一致すればその拠点を選ぶ', () => {
    expect(matchLocationByAddress('〒100-0000 東京都架空区架空町1丁目1番1号 架空ビル5階', locations)).toEqual({
      id: 'tokyo',
      name: '東京本社',
    });
  });

  it('都道府県・市区町村までしか一致しなければ決めない', () => {
    expect(matchLocationByAddress('大阪府架空市別町9-9-9', locations)).toBeNull();
  });

  it('同じ長さで一致する拠点が 2 つあれば決めない', () => {
    const twins = [
      { id: 'a', name: 'A 棟', address: '東京都架空区架空町1-1-1' },
      { id: 'b', name: 'B 棟', address: '東京都架空区架空町1-1-1' },
    ];
    expect(matchLocationByAddress('東京都架空区架空町1-1-1', twins)).toBeNull();
  });

  it('住所が読めなければ決めない', () => {
    expect(matchLocationByAddress(null, locations)).toBeNull();
    expect(matchLocationByAddress('東京都', locations)).toBeNull();
  });
});
