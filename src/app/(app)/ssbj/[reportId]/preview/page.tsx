import { SsbjPreview } from '@/features/ssbj/components/SsbjPreview.client';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  const { reportId } = await params;
  const { source } = await searchParams;
  // ?source=<保存版の ID> で、その保存版を表示した状態で開く（承認した版へのリンクなど）。
  return <SsbjPreview reportId={reportId} initialSource={typeof source === 'string' ? source : null} />;
}
