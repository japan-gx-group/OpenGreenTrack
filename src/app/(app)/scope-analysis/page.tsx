import { Suspense } from 'react';
import { ScopeAnalysis } from '@/features/scope-analysis/components/ScopeAnalysis.client';

// useSearchParams を使う Client Component は Suspense 境界が必須（Next.js App Router）。
export default function ScopeAnalysisPage() {
  return (
    <Suspense fallback={null}>
      <ScopeAnalysis />
    </Suspense>
  );
}
