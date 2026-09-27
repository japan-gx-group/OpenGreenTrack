import { SsbjReportDetail } from '@/features/ssbj/components/SsbjReportDetail.client';

// SSBJ レポートの詳細画面。データ取得・表示は feature 側（SsbjReportDetail）が担う。
export default async function SsbjReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <SsbjReportDetail reportId={reportId} />;
}
