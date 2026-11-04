import { TnfdReportDetail } from '@/features/tnfd/components/TnfdReportDetail.client';

// TNFD レポートの詳細画面。データ取得・表示は feature 側（TnfdReportDetail）が担う。
export default async function TnfdReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <TnfdReportDetail reportId={reportId} />;
}
