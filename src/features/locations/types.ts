// Region 系の正本は全体共有の src/types/region.ts。拠点機能からは自機能の型と同じ窓口
// （このファイル）でまとめて参照できるよう、ここで再エクスポートする。
import {
  REGIONS,
  REGION_LABELS,
  getRegionLabel,
  type Region,
} from '@/types/region';

export { REGIONS, REGION_LABELS, getRegionLabel };
export type { Region };

export const LOCATION_TYPES = [
  'headquarters',
  'branch',
  'factory',
  'office',
  'logistics',
  'service',
  'other',
] as const;

export const LOCATION_STATUSES = [
  'active',
  'paused',
  'preparing',
  'closing',
] as const;

export type LocationType = typeof LOCATION_TYPES[number];
export type LocationStatus = typeof LOCATION_STATUSES[number];

// 「算定Scope範囲」（DBの scopes カラム）は画面・CSV・型から外した。
// 設定しても算定・入力・表示のどこにも効かない「飾りの設定」だったため。
// DB列は据え置き（default '{}'）で、アプリからは読み書きしない。拠点別のScope制御が
// 本当に必要になったら、実際に効く実装（入力カテゴリの絞り込み・算定対象の制御）とセットで再導入する。

export interface LocationRecord {
  id: string;
  name: string;
  region: Region;
  type: LocationType;
  person: string;
  status: LocationStatus;
}

// 新規登録フォームの入力値。id はDB側で採番されるため持たない。
export type NewLocationInput = Omit<LocationRecord, 'id'>;

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  headquarters: '本社',
  branch: '支社',
  factory: '工場',
  office: 'オフィス',
  logistics: '物流拠点',
  service: 'サービス拠点',
  other: 'その他',
};

export const LOCATION_STATUS_LABELS: Record<LocationStatus, string> = {
  active: '稼働中',
  paused: '一時停止',
  preparing: '準備中',
  closing: '閉鎖予定',
};

export const getLocationTypeLabel = (type: LocationType) => LOCATION_TYPE_LABELS[type];
export const getLocationStatusLabel = (status: LocationStatus) => LOCATION_STATUS_LABELS[status];
