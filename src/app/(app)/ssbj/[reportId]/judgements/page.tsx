import { SsbjJudgements } from '@/features/ssbj/components/SsbjJudgements.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjJudgements reportId={reportId} />;
}
