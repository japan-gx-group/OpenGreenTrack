import { SsbjRisksOpportunities } from '@/features/ssbj/components/SsbjRisksOpportunities.client';

// SSBJ レポートのリスク・機会画面。データ取得・表示は feature 側（SsbjRisksOpportunities）が担う。
export default async function SsbjRisksOpportunitiesPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <SsbjRisksOpportunities reportId={reportId} />;
}
