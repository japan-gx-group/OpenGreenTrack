import { SsbjAuditLogs } from '@/features/ssbj/components/SsbjAuditLogs.client';
import { SsbjWorkingAccessGuard } from '@/features/ssbj/components/SsbjWorkingAccessGuard.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjWorkingAccessGuard reportId={reportId}><SsbjAuditLogs reportId={reportId} /></SsbjWorkingAccessGuard>;
}
