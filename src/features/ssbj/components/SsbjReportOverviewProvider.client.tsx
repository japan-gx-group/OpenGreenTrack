'use client';

// レポートの中の画面（/ssbj/[reportId]/**）に共通の情報を、レポートを開いている間 1 回だけ読んで配る（hooks/useSsbjReportOverview.ts）。
// レイアウト（app/(app)/ssbj/[reportId]/layout.tsx）で描くので、画面を移っても組み立て直さず、読み直さない。
// 閲覧者には作業中の内容・操作履歴を見せない（docs/authorization-matrix.md §2.3）ので、ロールが分かるまでと閲覧者のときは読まない。
// 印刷ビューでは画面の上の部品を出さないので、ロール以外は読まない。

import type { ReactNode } from 'react';
import { useSelectedLayoutSegments } from 'next/navigation';
import { useSsbjLatestReopen } from '../hooks/useSsbjLatestReopen';
import { useSsbjMembers } from '../hooks/useSsbjMembers';
import { useSsbjMyRole } from '../hooks/useSsbjMyRole';
import { SsbjReportOverviewContext, type SsbjReportOverview } from '../hooks/useSsbjReportOverview';
import { canViewSsbjWorking } from '../utils/memberRole';
import { ssbjReportRoute } from '../utils/reportRoute';

export const SsbjReportOverviewProvider = ({ reportId, children }: { reportId: string; children: ReactNode }) => {
  const route = ssbjReportRoute(useSelectedLayoutSegments());
  const role = useSsbjMyRole();
  const workingAccess = !role.isLoading && canViewSsbjWorking(role.role);
  const reopen = useSsbjLatestReopen(workingAccess && !route.isPrint ? reportId : null);
  // 利用者の一覧は、詳細画面（状態と承認）と差戻しの帯（差戻した人の名前）で使う。
  const members = useSsbjMembers(!route.isPrint && (route.current === '' || !!reopen.notice));

  const value: SsbjReportOverview = {
    reportId,
    route,
    role,
    members,
    workingAccess,
    reopen: { notice: reopen.notice, isLoading: reopen.isLoading, errorMessage: reopen.errorMessage },
    reloadStatus: () => {
      reopen.reload();
    },
  };

  return <SsbjReportOverviewContext.Provider value={value}>{children}</SsbjReportOverviewContext.Provider>;
};
