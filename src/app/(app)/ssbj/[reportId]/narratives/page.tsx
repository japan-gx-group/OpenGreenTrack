import { SsbjNarratives } from '@/features/ssbj/components/SsbjNarratives.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjNarratives reportId={reportId} />;
}
