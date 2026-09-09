// 拠点の稼働状況バッジ。一覧と詳細で同じ色使いにするためここに集約する。
// 稼働状況は活動量入力の拠点選択（稼働中・一時停止のみ選べる）に効くため、
// 「入力に使える状態か」が一目で分かる色にしている。

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { getLocationStatusLabel, type LocationStatus } from '@/features/locations/types';

const STATUS_BADGE_VARIANT: Record<LocationStatus, 'success' | 'warning' | 'info' | 'neutral'> = {
  active: 'success',
  paused: 'warning',
  preparing: 'info',
  closing: 'neutral',
};

export const LocationStatusBadge = ({ status }: { status: LocationStatus }) => (
  <Badge variant={STATUS_BADGE_VARIANT[status]}>{getLocationStatusLabel(status)}</Badge>
);
