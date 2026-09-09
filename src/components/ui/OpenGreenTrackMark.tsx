import type { CSSProperties } from 'react';

type OpenGreenTrackMarkProps = {
  size?: number;
  className?: string;
  style?: CSSProperties;
};

// OpenGreenTrack のロゴマーク（3本のリーフを傾けたモチーフ）。
// fill="currentColor" なので、置く場所の文字色（濃緑パネル上なら白、ペーパー地なら緑）で
// そのまま馴染む。3本の濃淡は opacity で出しているため色を1つ指定するだけでよい。
// ブラウザタブ用のファビコンは currentColor が効かないので public/favicon.svg に色を焼き込んで別管理している。
//
// viewBox と3本のパス・rotate は public/favicon.svg と共通仕様。形を変えるときは両方を同時に更新すること。
// viewBox の値は rotate(-22) 後の3本のバウンディングボックス（元データ opengreentrack-mark.svg 由来）。
export const OpenGreenTrackMark = ({ size = 24, className, style }: OpenGreenTrackMarkProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="-3.37 -4.45 24.61 24.04"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden
    focusable="false"
    className={className}
    style={style}
  >
    <g transform="rotate(-22 9.5 9.5)">
      <path d="M5,16 L5,8 A2.5,8 0 0 0 2.5,0 A2.5,8 0 0 0 0,8 A2.5,8 0 0 0 2.5,16 Z" />
      <path d="M12,16 L12,6 A2.5,10 0 0 0 9.5,-4 A2.5,10 0 0 0 7,6 A2.5,10 0 0 0 9.5,16 Z" opacity="0.72" />
      <path d="M19,16 L19,8 A2.5,8 0 0 0 16.5,0 A2.5,8 0 0 0 14,8 A2.5,8 0 0 0 16.5,16 Z" opacity="0.42" />
    </g>
  </svg>
);
