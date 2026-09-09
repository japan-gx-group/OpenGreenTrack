import { Suspense } from 'react';
import { ReportPrintView } from '@/features/reports/components/ReportPrintView.client';

// useSearchParams を使う Client Component は Suspense 境界が必須（Next.js App Router）。
export default function ReportPrintPage() {
  return (
    <Suspense fallback={null}>
      <ReportPrintView />
    </Suspense>
  );
}
