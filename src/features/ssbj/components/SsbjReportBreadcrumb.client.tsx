'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
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

const TabLinks = ({ reportId, currentPath }: { reportId: string; currentPath: string }) => {
  const { role } = useSsbjMyRole();
  const otherTabs = getVisibleSsbjReportContents(canViewSsbjWorking(role))
    .filter(content => content.path !== currentPath)
    .sort((left, right) => Number(right.viewer ?? false) - Number(left.viewer ?? false));

  return otherTabs.map(content => (
    <DropdownMenuItem key={content.path} asChild>
      <Link href={ssbjReportPath(reportId, content.path)}>{content.label}</Link>
    </DropdownMenuItem>
  ));
};

const TabMenu = ({ reportId, tab }: { reportId: string; tab: SsbjReportContent }) => {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="flex min-w-0 items-center gap-1 rounded-sm font-semibold text-text-heading hover:text-primary"
        aria-current="page"
      >
        <span className="truncate">{tab.label}</span>
        <ChevronDown size={13} aria-hidden="true" className="shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-max max-w-(--radix-dropdown-menu-content-available-width)">
        {/* 閉じるアニメーション中も、取得済みのロールは次回に持ち越さない。 */}
        {open && <TabLinks key={ssbjReportPath(reportId, tab.path)} reportId={reportId} currentPath={tab.path} />}
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

export const SsbjReportBreadcrumb = ({ reportId, tab }: { reportId: string; tab?: SsbjReportContent }) => (
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
        <TabMenu reportId={reportId} tab={tab} />
      </ReportCrumb>
    )}
  </>
);
