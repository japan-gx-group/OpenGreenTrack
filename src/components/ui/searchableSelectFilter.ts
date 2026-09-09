export interface SearchableSelectOption {
  value: string;
  label: string;
  /**
   * 絞り込みに使う文字列。省略時は label を使う。
   * 「表示は整形したいが検索は素の値で当てたい」場合（例: 事業者コード）に指定する。
   */
  searchText?: string;
}

/**
 * 検索キーワードと候補の突き合わせ用の正規化。
 * NFKC で全角英数を半角へ寄せ、小文字化して大小文字差を吸収する。
 * 日本語IMEのまま `Ａ０２６９` や `a0269` と打っても `A0269` に当たるようにするため。
 */
export const normalizeSearchText = (text: string): string => text.normalize('NFKC').toLowerCase();

/**
 * 候補リストをキーワードで絞り込む。キーワードが空なら全件返す。
 * 判定対象は searchText（未指定なら label）で、表示専用の装飾文字が
 * 検索に混ざらないようにしている。
 */
export const filterSearchableOptions = <T extends SearchableSelectOption>(
  options: readonly T[],
  query: string,
): T[] => {
  const keyword = normalizeSearchText(query.trim());
  if (!keyword) {
    return [...options];
  }
  return options.filter((option) =>
    normalizeSearchText(option.searchText ?? option.label).includes(keyword),
  );
};
