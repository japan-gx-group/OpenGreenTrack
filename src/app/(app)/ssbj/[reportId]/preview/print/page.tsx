import { Suspense } from 'react';
import { SsbjPreviewPrintView } from '@/features/ssbj/components/SsbjPreviewPrintView.client';

// useSearchParams を使う Client Component は Suspense 境界が必須（Next.js App Router）。
export default async function Page({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return (
    <Suspense fallback={null}>
      <SsbjPreviewPrintView reportId={reportId} />
    </Suspense>
  );
}
