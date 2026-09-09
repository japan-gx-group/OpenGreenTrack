import { LocationDetail } from '@/features/locations/components/LocationDetail.client';

// 拠点別Scope内訳の詳細画面。データ取得・表示は feature 側（LocationDetail）が担う。
export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  return <LocationDetail locationId={locationId} />;
}
