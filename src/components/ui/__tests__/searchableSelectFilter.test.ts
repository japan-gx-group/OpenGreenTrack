import { describe, expect, it } from 'vitest';
import { filterSearchableOptions, normalizeSearchText } from '../searchableSelectFilter';

const providerOptions = [
  {
    value: '東京電力エナジーパートナー',
    label: '東京電力エナジーパートナー（事業者コード: A0269）',
    searchText: '東京電力エナジーパートナー A0269',
  },
  {
    value: '東京ガス',
    label: '東京ガス（事業者コード: B0001）',
    searchText: '東京ガス B0001',
  },
  { value: '自家発電', label: '自家発電', searchText: '自家発電' },
];

const values = (query: string): string[] =>
  filterSearchableOptions(providerOptions, query).map((option) => option.value);

describe('filterSearchableOptions', () => {
  it('キーワードが空なら全件返す', () => {
    expect(values('')).toHaveLength(3);
    expect(values('   ')).toHaveLength(3);
  });

  it('事業者名の部分一致で絞り込む', () => {
    expect(values('東京')).toEqual(['東京電力エナジーパートナー', '東京ガス']);
  });

  it('事業者コードで絞り込める', () => {
    expect(values('A0269')).toEqual(['東京電力エナジーパートナー']);
  });

  it('コードの大文字小文字を区別しない', () => {
    expect(values('a0269')).toEqual(['東京電力エナジーパートナー']);
  });

  it('全角で入力されたコードも半角として扱う（日本語IME対策）', () => {
    expect(values('Ａ０２６９')).toEqual(['東京電力エナジーパートナー']);
    expect(values('ａ０２６９')).toEqual(['東京電力エナジーパートナー']);
  });

  it('ラベルの装飾文字（「事業者コード」）ではヒットしない', () => {
    expect(values('事業者コード')).toEqual([]);
  });

  it('searchText がない候補は label で判定する', () => {
    const options = [{ value: 'a', label: '拠点A' }];

    expect(filterSearchableOptions(options, '拠点')).toEqual(options);
    expect(filterSearchableOptions(options, '拠点B')).toEqual([]);
  });

  it('該当なしのときは空配列を返す', () => {
    expect(values('存在しない事業者')).toEqual([]);
  });
});

describe('normalizeSearchText', () => {
  it('NFKC 正規化と小文字化を行う', () => {
    expect(normalizeSearchText('Ａ０２６９')).toBe('a0269');
    expect(normalizeSearchText('ｶﾞｽ')).toBe('ガス');
  });
});
