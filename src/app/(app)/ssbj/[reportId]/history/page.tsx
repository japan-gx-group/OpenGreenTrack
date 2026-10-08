import { SsbjAuditLogs } from '@/features/ssbj/components/SsbjAuditLogs.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjAuditLogs reportId={reportId} />;
}
