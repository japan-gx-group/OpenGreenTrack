// 2 画面エディタで、左の入力と右のプレビューを、いま扱っている項目へ動かすための計算。
// 動きを減らす設定（prefers-reduced-motion）のときは、なめらかなスクロールにしない。

/** プレビューの項目に付ける目印の属性（値は項目 ID）。 */
export const SSBJ_PREVIEW_ITEM_ATTRIBUTE = 'data-ssbj-item-id';

/** スクロールしたとき、項目の上に空けておく余白（px）。 */
const MARGIN = 16;

interface VerticalBox {
  top: number;
  bottom: number;
}

/**
 * スクロールする枠（container）の中で、項目（target）が見えるようにするための scrollTop。
 * 項目がすでに枠の中に全部見えているときは null（動かさない。書いている間に右が揺れないように）。
 * 項目が枠より高いときは、項目の先頭を枠の上に合わせる。
 */
export const ssbjPreviewScrollTop = (container: VerticalBox, target: VerticalBox, scrollTop: number): number | null => {
  if (target.top >= container.top && target.bottom <= container.bottom) return null;
  return Math.max(0, scrollTop + (target.top - container.top) - MARGIN);
};

/** 利用者が動きを減らす設定にしていれば 'auto'、そうでなければ 'smooth'。 */
export const ssbjScrollBehavior = (): ScrollBehavior => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'auto';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
};
