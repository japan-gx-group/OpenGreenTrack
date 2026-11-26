import type { ReactNode } from 'react';
import { SsbjReportHeader } from '@/features/ssbj/components/SsbjReportHeader.client';
import { SsbjReportOverviewProvider } from '@/features/ssbj/components/SsbjReportOverviewProvider.client';

// SSBJ レポートの中の画面（/ssbj/[reportId]/**）に共通のレイアウト。レポートに共通の情報（ロール・最新の差戻しなど）を
// SsbjReportOverviewProvider が 1 回だけ読み、画面の上の共通部品（SsbjReportHeader）と各画面が使う。
// レイアウトは画面を移っても描き直されないので、画面ごとに読み直さない。印刷ビューでは SsbjReportHeader は何も出さない。
export default async function SsbjReportLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return (
    <SsbjReportOverviewProvider reportId={reportId}>
      <SsbjReportHeader />
      {children}
    </SsbjReportOverviewProvider>
  );
}
