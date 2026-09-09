// 一覧画面のページネーションで共有する純粋関数。
// 排出係数マスタ（Factors）と入力履歴（DataInput）で同じ表示ルールを使うため、
// 画面側にコピーを持たずここに集約する。
//
// なお総ページ数や現在ページのクランプ（Math.max/Math.ceil 程度の式）はここに置かない。
// 関数の戻り値を useMemo の依存配列に置くと React Compiler が
// 「後から変わり得る値」と判断して最適化を諦める（react-hooks/preserve-manual-memoization）ため、
// 各画面でインラインの式のまま扱う。

// ページ番号ボタンの並び。'gap' は省略記号（…）を表す。
export type PageItem = number | 'gap';

// 全ページ数がこの値以下なら省略記号を使わず全ページ分のボタンを描画する。
// （「1 … 2」のように無意味な省略が出ないようにするための閾値）
const FULL_LIST_MAX_PAGES = 7;

/** 省略記号が出る（＝ボタンが出ないページがある）か。ページ番号直接入力の表示条件。 */
export const hasHiddenPages = (total: number): boolean => total > FULL_LIST_MAX_PAGES;

/**
 * ページ番号ボタンを「先頭・末尾・現在ページ周辺」だけに絞り、間を省略記号にする。
 * 公式係数の投入などでページ数が数百に達しても、描画するボタン数を一定に保つ。
 */
export const buildPageItems = (current: number, total: number): PageItem[] => {
  if (total <= FULL_LIST_MAX_PAGES) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const shown = new Set<number>([1, total, current, current - 1, current + 1]);
  const pages = [...shown]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const items: PageItem[] = [];
  let previousPage = 0;

  for (const page of pages) {
    if (page - previousPage > 1) {
      items.push('gap');
    }
    items.push(page);
    previousPage = page;
  }

  return items;
};
