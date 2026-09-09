// トリーマップのブロック面積（大／中／小）を実排出量の順位から決めるための純関数。
// 表示の見た目に関わるロジックをコンポーネントから切り出し、単体テスト可能にしている。

export type BlockSize = 'large' | 'medium' | 'small';

export interface BlockLayout {
  /** 排出量降順の 0 始まりランク（同値は入力順で先に現れたものを上位として扱う） */
  rank: number;
  /** ランクと排出量に応じたブロックの大きさ（＝面積） */
  size: BlockSize;
}

// rank 0 を大、rank 1〜2 を中、それ以外を小にする。
// 厳密な squarified treemap ではなく、「降順で大／中／小を割り当てる簡易版」。
const MEDIUM_RANK_LIMIT = 2;

const sizeForRank = (rank: number, emissions: number): BlockSize => {
  // 排出量が 0 以下のカテゴリは面積で強調しない（0値の穴埋め・見た目の破綻防止）。
  if (emissions <= 0) return 'small';
  if (rank === 0) return 'large';
  if (rank <= MEDIUM_RANK_LIMIT) return 'medium';
  return 'small';
};

/**
 * 各カテゴリの排出量配列を受け取り、入力と同じ並び順で {rank, size} を返す。
 * - 面積は実排出量の降順ランクに連動する（最大 = 大 2×2 相当）。
 * - 同値は安定ソートで入力順を保持し、決定的に割り当てる。
 * - カテゴリ数は可変（0〜N）でよい。
 */
export const assignBlockLayout = (emissions: number[]): BlockLayout[] => {
  const ranked = emissions
    .map((value, index) => ({ value, index }))
    // 排出量降順。同値のときは元の並び（index 昇順）を保って安定させる。
    .sort((a, b) => b.value - a.value || a.index - b.index);

  const layouts = new Array<BlockLayout>(emissions.length);
  ranked.forEach((entry, rank) => {
    layouts[entry.index] = {
      rank,
      size: sizeForRank(rank, entry.value),
    };
  });
  return layouts;
};
