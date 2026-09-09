'use client';

// KPI カード下端に敷く極小の折れ線（スパークライン）。
// 目盛りも軸も持たず「増えているか減っているか」の形だけを伝える装飾のため、
// 数値は隣の大きな値と増減ピルが受け持つ（aria-hidden で読み上げから外す）。
// recharts はカード1枚ごとに ResponsiveContainer を持つと重いので、素の SVG で描く。

const WIDTH = 300;
const HEIGHT = 42;
/** 線が上端・下端に張り付かないよう上下に取る余白 */
const PADDING_TOP = 12;
const PADDING_BOTTOM = 2;

/** Catmull-Rom 風に制御点を置いて角を丸める。点が2つ未満なら描かない。 */
const toSmoothPath = (points: [number, number][]): string => {
  if (points.length < 2) return '';
  const tension = 0.2;
  let path = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const previous = points[Math.max(0, i - 1)];
    const start = points[i];
    const end = points[i + 1];
    const next = points[Math.min(points.length - 1, i + 2)];
    const c1x = start[0] + (end[0] - previous[0]) * tension;
    const c1y = start[1] + (end[1] - previous[1]) * tension;
    const c2x = end[0] - (next[0] - start[0]) * tension;
    const c2y = end[1] - (next[1] - start[1]) * tension;
    path += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${end[0].toFixed(1)},${end[1].toFixed(1)}`;
  }
  return path;
};

export const Sparkline = ({
  values,
  color,
  gradientId,
}: {
  values: number[];
  /** 線の色（CSS変数可）。塗りは同色のグラデーション */
  color: string;
  /** 同一ページ内で衝突しない一意なID */
  gradientId: string;
}) => {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // 全月0（月別内訳を持たない Scope 3 など）のときは、カード下端の直線が
  // 罫線に見えて誤読を招くため何も描かない。
  if (max <= 0) return null;
  const range = max - min || 1;
  const points = values.map(
    (value, index): [number, number] => [
      (index * WIDTH) / (values.length - 1),
      HEIGHT - PADDING_BOTTOM - ((value - min) / range) * (HEIGHT - PADDING_TOP - PADDING_BOTTOM),
    ],
  );

  const line = toSmoothPath(points);
  if (line === '') return null;

  return (
    <svg
      aria-hidden="true"
      width="100%"
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', left: 0, bottom: 0, display: 'block' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z`} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};
