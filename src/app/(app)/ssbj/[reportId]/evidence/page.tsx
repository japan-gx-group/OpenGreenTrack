import { SsbjEvidencePage } from '@/features/ssbj/components/SsbjEvidencePage.client';
import { SsbjWorkingAccessGuard } from '@/features/ssbj/components/SsbjWorkingAccessGuard.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjWorkingAccessGuard reportId={reportId}><SsbjEvidencePage reportId={reportId} /></SsbjWorkingAccessGuard>;
}
