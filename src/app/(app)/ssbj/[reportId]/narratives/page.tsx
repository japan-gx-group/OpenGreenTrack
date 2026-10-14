import { SsbjNarratives } from '@/features/ssbj/components/SsbjNarratives.client';
import { SsbjWorkingAccessGuard } from '@/features/ssbj/components/SsbjWorkingAccessGuard.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjWorkingAccessGuard reportId={reportId}><SsbjNarratives reportId={reportId} /></SsbjWorkingAccessGuard>;
}
