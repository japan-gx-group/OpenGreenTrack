'use client';

// SSBJ の作業中の内容を見る画面（文章・リスク・機会・判断・根拠文書・GHG・操作履歴）の入口。
// 閲覧者は作業中の内容を見られない（DB の RLS も返さない。docs/authorization-matrix.md §2.3）ので、
// 画面の代わりに、承認した保存版の見方を案内する（行の無い表を「未入力」と誤って見せないため）。

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { useSsbjMyRole } from '../hooks/useSsbjMyRole';
import { canViewSsbjWorking } from '../utils/memberRole';

export const SsbjWorkingAccessGuard = ({ reportId, children }: { reportId: string; children: ReactNode }) => {
  const myRole = useSsbjMyRole();
  if (myRole.isLoading) {
    return <div className="page-content"><Card><LoadingIndicator label="権限を確かめています..." /></Card></div>;
  }
  if (canViewSsbjWorking(myRole.role)) return <>{children}</>;

  const base = `/ssbj/${encodeURIComponent(reportId)}`;
  return (
    <div className="page-content flex flex-col gap-4">
      <Link href={base} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft size={16} /> レポート詳細へ戻る
      </Link>
      <Card data-testid="ssbj-working-access-denied" className="flex flex-col items-center gap-2 py-12 text-center">
        <Eye aria-hidden="true" size={40} className="text-text-muted opacity-50" />
        <p className="m-0 text-base font-bold">作業中の内容は見られません</p>
        <p className="m-0 text-sm text-text-muted">
          {myRole.errorMessage || 'SSBJ の閲覧者は、承認済みのレポートの承認した保存版だけを見られます。'}
        </p>
        <Link href={`${base}/preview`} className="text-sm font-semibold text-primary hover:underline">承認した保存版を見る</Link>
      </Card>
    </div>
  );
};
