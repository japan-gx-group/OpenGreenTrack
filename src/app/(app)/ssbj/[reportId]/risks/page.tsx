import { SsbjRisksOpportunities } from '@/features/ssbj/components/SsbjRisksOpportunities.client';
import { SsbjWorkingAccessGuard } from '@/features/ssbj/components/SsbjWorkingAccessGuard.client';

// SSBJ レポートのリスク・機会画面。データ取得・表示は feature 側（SsbjRisksOpportunities）が担う。
export default async function SsbjRisksOpportunitiesPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <SsbjWorkingAccessGuard reportId={reportId}><SsbjRisksOpportunities reportId={reportId} /></SsbjWorkingAccessGuard>;
}
