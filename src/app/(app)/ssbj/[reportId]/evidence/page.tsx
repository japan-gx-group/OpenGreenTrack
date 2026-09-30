import { SsbjEvidencePage } from '@/features/ssbj/components/SsbjEvidencePage.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjEvidencePage reportId={reportId} />;
}
