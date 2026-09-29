import { SsbjPreview } from '@/features/ssbj/components/SsbjPreview.client';

export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjPreview reportId={reportId} />;
}
