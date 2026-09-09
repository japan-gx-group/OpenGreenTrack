// Region は特定機能ではなく複数機能（拠点管理・算定・レポート）が共有するドメイン値。
// どれか1機能の配下に置くと features 間 import を招くため、全体共有の型としてここに置く（AGENTS.md R3）。

export const REGIONS = [
  'Hokkaido',
  'Tohoku',
  'Kanto',
  'Chubu',
  'Kansai',
  'Chugoku_Shikoku',
  'Kyushu',
  'Overseas',
] as const;

export type Region = typeof REGIONS[number];

export const REGION_LABELS: Record<Region, string> = {
  Hokkaido: '北海道',
  Tohoku: '東北',
  Kanto: '関東',
  Chubu: '中部',
  Kansai: '関西',
  Chugoku_Shikoku: '中国・四国',
  Kyushu: '九州',
  Overseas: '海外',
};

export const getRegionLabel = (region: Region) => REGION_LABELS[region];
