'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSsbjMyRole } from '../hooks/useSsbjMyRole';
import { canViewSsbjWorking } from '../utils/memberRole';
import { getVisibleSsbjReportContents, ssbjReportPath, type SsbjReportContent } from '../utils/reportContents';

const TabMenu = ({ reportId, tab, isPrint }: { reportId: string; tab: SsbjReportContent; isPrint: boolean }) => {
  const { role } = useSsbjMyRole();
  const otherTabs = getVisibleSsbjReportContents(canViewSsbjWorking(role))
    .filter(content => isPrint || content.path !== tab.path);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 items-center gap-1 rounded-sm font-semibold text-text-heading hover:text-primary"
        aria-current="page"
      >
        <span className="truncate">{tab.label}</span>
        <ChevronDown size={13} aria-hidden="true" className="shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-max max-w-(--radix-dropdown-menu-content-available-width)">
        {otherTabs.map(content => (
          <DropdownMenuItem key={content.path} asChild>
            <Link href={ssbjReportPath(reportId, content.path)}>{content.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ReportCrumb = ({ children }: { children: ReactNode }) => (
  <span className="flex min-w-0 items-center gap-2">
    <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-text-subtle" />
    {children}
  </span>
);

export const SsbjReportBreadcrumb = ({
  reportId, tab, isPrint,
}: { reportId: string; tab?: SsbjReportContent; isPrint: boolean }) => (
  <>
    <ReportCrumb>
      <Link href="/ssbj" className="truncate hover:text-primary hover:underline">SSBJレポート</Link>
    </ReportCrumb>
    <ReportCrumb>
      {tab ? (
        <Link href={ssbjReportPath(reportId, '')} className="truncate hover:text-primary hover:underline">SSBJレポート詳細</Link>
      ) : (
        <span className="truncate font-semibold text-text-heading" aria-current="page">SSBJレポート詳細</span>
      )}
    </ReportCrumb>
    {tab && (
      <ReportCrumb>
        <TabMenu reportId={reportId} tab={tab} isPrint={isPrint} />
      </ReportCrumb>
    )}
  </>
);
