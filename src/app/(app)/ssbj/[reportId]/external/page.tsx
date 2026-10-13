import { SsbjExternalEmissions } from '@/features/ssbj/components/SsbjExternalEmissions.client';
import { SsbjWorkingAccessGuard } from '@/features/ssbj/components/SsbjWorkingAccessGuard.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjWorkingAccessGuard reportId={reportId}><SsbjExternalEmissions reportId={reportId} /></SsbjWorkingAccessGuard>;
}
