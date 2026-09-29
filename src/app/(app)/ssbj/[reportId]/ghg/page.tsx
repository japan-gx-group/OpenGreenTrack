import { SsbjOgtCandidates } from '@/features/ssbj/components/SsbjOgtCandidates.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjOgtCandidates reportId={reportId} />;
}
