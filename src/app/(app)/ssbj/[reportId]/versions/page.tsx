import { SsbjVersions } from '@/features/ssbj/components/SsbjVersions.client';

export default async function SsbjVersionsPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <SsbjVersions reportId={reportId} />;
}
